import { randomUUID } from 'node:crypto';
import type { BetaTextBlockParam } from '@anthropic-ai/sdk/resources/beta.mjs';
import { CacheTtl } from '../public/enums';
import { IQueryRunner, type IToolRegistry, type ITurnRunner } from '../public/interfaces';
import type { DurableConfig, ILogger, PerQueryInput, SdkMessage, ToolResultBlock, TransformToolResult } from '../public/types';
import type { ApprovalCoordinator } from './ApprovalCoordinator';
import type { IControlChannel } from './ControlChannel';
import type { Conversation } from './Conversation';
import { calculateCost, getContextWindow } from './pricing';
import type { ToolUseResult } from './types';

/**
 * Long-lived query runner. Constructed once at consumer setup with its
 * dependencies and reused for every query. A query is one user ask turned
 * into however many turns the model needs to answer it.
 *
 * The runner owns the turn loop and the tool dispatch between turns. It
 * delegates the per-turn HTTP cycle to the injected `ITurnRunner` and the
 * per-tool validation and handler invocation to the injected
 * `IToolRegistry`.
 *
 * Constructor dependencies are all long-lived:
 * - `ITurnRunner` — runs one request-and-response cycle per call.
 * - `Conversation` — the in-memory message list; mutated by the turn runner
 *   (assistant message pushes) and by the query runner (user message and
 *   tool_result pushes).
 * - `IToolRegistry` — resolves tool_use blocks and exposes `run` closures.
 * - `ApprovalCoordinator` — per-query cancel flag and pending-approval promises.
 * - `IControlChannel` — outbound SDK events to the consumer.
 * - `DurableConfig` — the long-lived config (model, tools, betas, cache
 *   TTL, systemPrompts, cachedReminders, requireToolApproval, etc.).
 *
 * Per-query input arrives via `run`: the user messages, the one-shot
 * `systemReminder`, the optional per-query transform hook, and a fresh
 * `AbortController` whose signal is threaded into every turn.
 *
 * NOT responsibilities:
 * - Closing the control channel. The channel is long-lived and owned by the
 *   consumer; closing it per query would break every subsequent query on
 *   the same SDK instance.
 * - Subscribing to stream events. The consumer subscribes to the injected
 *   `IStreamProcessor` once at setup and the same handlers fire for every
 *   stream the turn runner processes.
 * - Pushing the assembled assistant message into the `Conversation`. The
 *   turn runner does that directly when the stream ends; the query runner
 *   only inspects the returned `MessageStreamResult` for the stop reason,
 *   the tool_use blocks, and the usage for the `message_usage` channel send.
 */
export class QueryRunner extends IQueryRunner {
  readonly #turnRunner: ITurnRunner;
  readonly #conversation: Conversation;
  readonly #registry: IToolRegistry;
  readonly #approval: ApprovalCoordinator;
  readonly #channel: IControlChannel;
  readonly #durable: DurableConfig;
  readonly #logger: ILogger | undefined;

  public constructor(turnRunner: ITurnRunner, conversation: Conversation, registry: IToolRegistry, approval: ApprovalCoordinator, channel: IControlChannel, durable: DurableConfig, logger?: ILogger) {
    super();
    this.#turnRunner = turnRunner;
    this.#conversation = conversation;
    this.#registry = registry;
    this.#approval = approval;
    this.#channel = channel;
    this.#durable = durable;
    this.#logger = logger;
  }

  public async run(input: PerQueryInput): Promise<void> {
    // Clear any `cancelled` flag left over from a previous cancelled query
    // on this shared `ApprovalCoordinator`.
    this.#approval.reset();

    // Inject cachedReminders when there are no user messages in history.
    // Covers both a fresh conversation and a post-compaction state where the
    // original first user message (which held the cached reminders) has
    // been dropped by the API.
    const cachedReminders = this.#durable.cachedReminders;
    const injectReminders = cachedReminders != null && cachedReminders.length > 0 && !this.#conversation.messages.some((m) => m.role === 'user');

    let isFirst = true;
    for (const msg of input.messages) {
      if (typeof msg === 'string') {
        // Plain string message: wrap in a user message, optionally injecting cached reminders.
        if (isFirst && injectReminders) {
          const reminderBlocks: BetaTextBlockParam[] = cachedReminders.map((text, i, arr) => ({
            type: 'text' as const,
            text: `<system-reminder>\n${text}\n</system-reminder>\n${i === arr.length - 1 ? '\n' : ''}`,
          }));
          this.#conversation.push({ role: 'user', content: [...reminderBlocks, { type: 'text' as const, text: msg }] });
        } else {
          this.#conversation.push({ role: 'user', content: msg });
        }
      } else {
        // Pre-built structured BetaMessageParam: push directly, injecting reminders if needed.
        if (isFirst && injectReminders) {
          const reminderBlocks: BetaTextBlockParam[] = cachedReminders.map((text, i, arr) => ({
            type: 'text' as const,
            text: `<system-reminder>\n${text}\n</system-reminder>\n${i === arr.length - 1 ? '\n' : ''}`,
          }));
          const existingContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text' as const, text: msg.content }];
          this.#conversation.push({ role: msg.role, content: [...reminderBlocks, ...existingContent] });
        } else {
          this.#conversation.push(msg);
        }
      }
      isFirst = false;
    }

    // Turn loop. Exits on terminal stop reason, empty-tool-use give-up,
    // turn runner error, or cancel.
    let systemReminder = input.systemReminder;
    let emptyToolUseRetries = 0;
    while (!this.#approval.cancelled) {
      this.#logger?.debug('messages', { messages: this.#conversation.messages.length });

      // query_summary channel send (pre-turn).
      // counts are computed from the full history before the next request.
      const messages = this.#conversation.messages;
      const userMessages = messages.filter((m) => m.role === 'user').length;
      const assistantMessages = messages.filter((m) => m.role === 'assistant').length;
      const thinkingBlocks = messages
        .filter((m) => m.role === 'assistant')
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .filter((b) => b.type === 'thinking').length;
      const systemPromptCount = 1 + (this.#durable.systemPrompts?.length ?? 0);
      this.#channel.send({ type: 'query_summary', systemPrompts: systemPromptCount, userMessages, assistantMessages, thinkingBlocks, systemReminder });

      let result: Awaited<ReturnType<ITurnRunner['run']>>;
      try {
        result = await this.#turnRunner.run(this.#conversation, this.#durable, {
          systemReminder,
          abortSignal: input.abortController.signal,
        });
      } catch (err) {
        if (err instanceof Error) {
          this.#channel.send({ type: 'error', message: err.message });
        }
        return;
      }
      // One-shot: only the first turn of a query carries the systemReminder.
      systemReminder = undefined;

      const cacheTtl = this.#durable.cacheTtl ?? CacheTtl.OneHour;
      const costUsd = calculateCost(result.usage, this.#durable.model, cacheTtl);
      const contextWindow = getContextWindow(this.#durable.model);
      this.#channel.send({ type: 'message_usage', ...result.usage, costUsd, contextWindow } satisfies SdkMessage);

      const toolUses = result.blocks.filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use');

      if (result.stopReason !== 'tool_use') {
        this.#channel.send({ type: 'done', stopReason: result.stopReason ?? 'end_turn' });
        break;
      }

      if (toolUses.length === 0) {
        if (emptyToolUseRetries < 2) {
          emptyToolUseRetries++;
          this.#logger?.warn('stop_reason was tool_use but no tool uses accumulated — retrying', { attempt: emptyToolUseRetries });
          continue;
        }
        this.#logger?.warn('stop_reason was tool_use but no tool uses accumulated — giving up after retries');
        this.#channel.send({ type: 'error', message: 'stop_reason was tool_use but no tool uses found' });
        break;
      }

      emptyToolUseRetries = 0;
      const toolResults = await this.#handleTools(toolUses, input.transformToolResult);
      this.#conversation.push({ role: 'user', content: toolResults });
    }
  }

  /**
   * Tool dispatch logic, structured around `IToolRegistry.resolve`.
   *
   * Two phases:
   *
   * 1. Resolve every `tool_use`. Each resolve call parses the input once.
   *    `not_found` is logged silently and emits an error `tool_result`.
   *    `invalid_input` broadcasts `tool_error` on the channel and emits an
   *    error `tool_result`. `ready` results are accumulated with their
   *    `run` closures for the second phase.
   * 2. Execute the `ready` list. If approval is required, all approval
   *    requests are fired in parallel and the closures are invoked in the
   *    order the approvals arrive (`Promise.race`). Otherwise the closures
   *    run sequentially in the model's order. Both paths respect the
   *    `cancelled` flag between items.
   */
  async #handleTools(toolUses: ToolUseResult[], transformToolResult: TransformToolResult | undefined) {
    const requireApproval = this.#durable.requireToolApproval ?? false;
    const toolResults: ToolResultBlock[] = [];

    // Phase 1: resolve and filter. Parse every tool_use once; route errors
    // to immediate tool_result blocks without requesting approval or
    // running any handler.
    const ready: Array<{ toolUse: ToolUseResult; run: (transform?: TransformToolResult) => Promise<ToolResultBlock> }> = [];
    for (const toolUse of toolUses) {
      const resolved = this.#registry.resolve(toolUse.name, toolUse.input);
      if (resolved.kind === 'not_found') {
        const content = `Tool not found: ${toolUse.name}`;
        this.#logger?.debug('tool_result_error', { name: toolUse.name, content });
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: [{ type: 'text' as const, text: content }] });
        continue;
      }
      if (resolved.kind === 'invalid_input') {
        this.#logger?.debug('tool_parse_error', { name: toolUse.name, error: resolved.error });
        this.#channel.send({ type: 'tool_error', name: toolUse.name, input: toolUse.input, error: resolved.error });
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: [{ type: 'text' as const, text: `Invalid input: ${resolved.error}` }] });
        continue;
      }
      // Capture the run closure plus a wrapping function that invokes it
      // and builds the tool_result block with the matching tool_use_id.
      const resolvedRun = resolved.run;
      const toolUseRef = toolUse;
      ready.push({
        toolUse: toolUseRef,
        run: async (transform) => {
          const runResult = await resolvedRun(transform);
          if (runResult.kind === 'handler_error') {
            this.#logger?.debug('tool_handler_error', { name: toolUseRef.name, error: runResult.error });
            this.#channel.send({ type: 'tool_error', name: toolUseRef.name, input: toolUseRef.input, error: runResult.error });
            return { type: 'tool_result', tool_use_id: toolUseRef.id, is_error: true, content: [{ type: 'text' as const, text: runResult.error }] };
          }
          const content = [{ type: 'text' as const, text: runResult.content }, ...(runResult.blocks ?? [])];
          return { type: 'tool_result', tool_use_id: toolUseRef.id, content };
        },
      });
    }

    // Phase 2: execute the ready list.
    if (requireApproval) {
      const pending = ready.map(({ toolUse, run }) => {
        const requestId = randomUUID();
        return {
          toolUse,
          run,
          promise: this.#approval.request(requestId, () => {
            this.#channel.send({ type: 'tool_approval_request', requestId, name: toolUse.name, input: toolUse.input } satisfies SdkMessage);
          }),
        };
      });

      while (pending.length > 0) {
        if (this.#approval.cancelled) {
          break;
        }
        const { toolUse, run, response, index } = await Promise.race(pending.map((item, idx) => item.promise.then((response) => ({ toolUse: item.toolUse, run: item.run, response, index: idx }))));
        pending.splice(index, 1);

        if (!response.approved) {
          const content = response.reason ?? 'Rejected by user, do not reattempt';
          this.#logger?.debug('tool_rejected', { name: toolUse.name, reason: content });
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: [{ type: 'text' as const, text: content }] });
          continue;
        }

        toolResults.push(await run(transformToolResult));
      }
    } else {
      for (const { run } of ready) {
        if (this.#approval.cancelled) {
          break;
        }
        toolResults.push(await run(transformToolResult));
      }
    }

    return toolResults;
  }
}
