import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { dependsOn } from '@shellicar/core-di-lite';
import { IDurableConfigProvider } from '../public/IDurableConfigProvider';
import { ISdkMessagePublisher } from '../public/ISdkMessagePublisher';
import { IQueryRunner, IToolRegistry, ITurnRunner } from '../public/interfaces';
import type { PerQueryInput, SdkMessage, ToolOutcome, ToolResultBlock, TransformToolResult } from '../public/types';
import { IToolsClockListener } from '../public/types';
import { ApprovalCoordinator } from './ApprovalCoordinator';
import { Conversation } from './Conversation';
import { buildReminderBlocks } from './claudeMdReminders';
import { AccountLimitStoppedError, toSdkErrorDetail } from './http/errors';
import { calculateCostSplit, getContextWindow } from './pricing';
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
 * - `IPublisher<SdkMessage>` — outbound SDK events to the consumer.
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
  @dependsOn(ITurnRunner) private readonly turnRunner!: ITurnRunner;
  @dependsOn(Conversation) private readonly conversation!: Conversation;
  @dependsOn(IToolRegistry) private readonly registry!: IToolRegistry;
  @dependsOn(ApprovalCoordinator) private readonly approval!: ApprovalCoordinator;
  @dependsOn(ISdkMessagePublisher) private readonly publisher!: ISdkMessagePublisher;
  @dependsOn(IDurableConfigProvider) private readonly durableProvider!: IDurableConfigProvider;
  @dependsOn(ILogger) private readonly logger!: ILogger;
  @dependsOn(IToolsClockListener) private readonly toolsClock!: IToolsClockListener;

  public async run(input: PerQueryInput): Promise<void> {
    // Clear any `cancelled` flag left over from a previous cancelled query
    // on this shared `ApprovalCoordinator`.
    this.approval.reset();

    // Inject cachedReminders into the first user message of a fresh conversation
    // (no user messages in history yet), so they are persisted as its leading
    // blocks. The post-compaction case, where the request slice no longer carries
    // that message, is handled per-request by TurnRunner's ensureClaudeMdReminders.
    const cachedReminders = this.durableProvider.config.cachedReminders;
    const injectReminders = cachedReminders != null && cachedReminders.length > 0 && !this.conversation.messages.some((m) => m.role === 'user');

    let isFirst = true;
    for (const msg of input.messages) {
      if (typeof msg === 'string') {
        // Plain string message: wrap in a user message, optionally injecting cached reminders.
        if (isFirst && injectReminders) {
          const reminderBlocks = buildReminderBlocks(cachedReminders);
          this.conversation.push({ role: 'user', content: [...reminderBlocks, { type: 'text' as const, text: msg }] });
        } else {
          this.conversation.push({ role: 'user', content: msg });
        }
      } else {
        // Pre-built structured BetaMessageParam: push directly, injecting reminders if needed.
        if (isFirst && injectReminders) {
          const reminderBlocks = buildReminderBlocks(cachedReminders);
          const existingContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text' as const, text: msg.content }];
          this.conversation.push({ role: msg.role, content: [...reminderBlocks, ...existingContent] });
        } else {
          this.conversation.push(msg);
        }
      }
      isFirst = false;
    }

    // Turn loop. Exits on terminal stop reason, empty-tool-use give-up,
    // turn runner error, or cancel.
    let systemReminder = input.systemReminder;
    let emptyToolUseRetries = 0;
    while (!this.approval.cancelled) {
      this.logger.debug('messages', { messages: this.conversation.messages.length });

      // query_summary channel send (pre-turn).
      // counts are computed from the full history before the next request.
      const messages = this.conversation.messages;
      const userMessages = messages.filter((m) => m.role === 'user').length;
      const assistantMessages = messages.filter((m) => m.role === 'assistant').length;
      const thinkingBlocks = messages
        .filter((m) => m.role === 'assistant')
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .filter((b) => b.type === 'thinking').length;
      const systemPromptCount = 1 + (this.durableProvider.config.systemPrompts?.length ?? 0);
      this.publisher.send({ type: 'query_summary', systemPrompts: systemPromptCount, userMessages, assistantMessages, thinkingBlocks, systemReminder });

      let result: Awaited<ReturnType<ITurnRunner['run']>>;
      try {
        result = await this.turnRunner.run(this.conversation, this.durableProvider.config, {
          systemReminder,
          abortSignal: input.abortController.signal,
        });
      } catch (err) {
        // Account-limit give-up: a deliberate stop, already surfaced as the 🛑
        // notice by the retry loop. End the query cleanly — no error line.
        if (err instanceof AccountLimitStoppedError) {
          return;
        }
        if (err instanceof Error) {
          const detail = toSdkErrorDetail(err);
          this.publisher.send({ type: 'error', message: err.message, ...(detail ? { detail } : {}) });
        }
        return;
      }
      // One-shot: only the first turn of a query carries the systemReminder.
      systemReminder = undefined;

      const costUsd = calculateCostSplit(
        {
          inputTokens: result.usage.inputTokens,
          cacheCreation5mTokens: result.usage.cacheCreation5mTokens,
          cacheCreation1hTokens: result.usage.cacheCreation1hTokens,
          cacheReadTokens: result.usage.cacheReadTokens,
          outputTokens: result.usage.outputTokens,
        },
        this.durableProvider.config.model,
      );
      const contextWindow = getContextWindow(this.durableProvider.config.model);
      this.publisher.send({ type: 'message_usage', ...result.usage, costUsd, contextWindow } satisfies SdkMessage);
      this.publisher.send({ type: 'turn_content', blocks: result.blocks } satisfies SdkMessage);

      const toolUses = result.blocks.filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use');

      if (result.stopReason !== 'tool_use') {
        this.publisher.send({ type: 'done', stopReason: result.stopReason ?? 'end_turn' });
        break;
      }

      if (toolUses.length === 0) {
        if (emptyToolUseRetries < 2) {
          emptyToolUseRetries++;
          // stop_reason was tool_use but the call was mis-generated into a
          // text block, so no tool_use block exists. The turn runner has
          // already appended this corrupt assistant turn. Leaving it in place
          // makes the next request end on an assistant message, which the API
          // rejects as prefill (400), and feeds the garble back into context
          // where it is self-reinforcing. Roll the turn back before resending.
          // Guard on the role so an empty-content turn (nothing appended)
          // cannot drop a preceding user message.
          if (this.conversation.messages.at(-1)?.role === 'assistant') {
            this.conversation.removeLast();
          }
          this.logger.warn('stop_reason was tool_use but no tool uses accumulated — rolling back turn and retrying', { attempt: emptyToolUseRetries });
          continue;
        }
        this.logger.warn('stop_reason was tool_use but no tool uses accumulated — giving up after retries');
        this.publisher.send({ type: 'error', message: 'stop_reason was tool_use but no tool uses found' });
        break;
      }

      emptyToolUseRetries = 0;
      const toolResults = await this.#handleTools(toolUses, input.transformToolResult);
      this.conversation.push({ role: 'user', content: toolResults });
    }
  }

  /**
   * Tool-time bracket. The tools clock is on for the whole extent of tool
   * handling: it starts on entry and stops on every exit — normal return,
   * thrown error, or an empty/all-rejected batch where nothing runs. The
   * approval wait, and any path where no tool actually runs, fall inside the
   * bracket, so that time counts as tool time instead of going unattributed.
   */
  async #handleTools(toolUses: ToolUseResult[], transformToolResult: TransformToolResult | undefined) {
    this.toolsClock.toolsStarted();
    try {
      return await this.#runTools(toolUses, transformToolResult);
    } finally {
      this.toolsClock.toolsStopped();
    }
  }

  /**
   * Tool dispatch logic, structured around `IToolRegistry.resolve`.
   *
   * Two phases:
   *
   * 1. Resolve every `tool_use`. Each resolve call parses the input once.
   *    A non-`ready` outcome (`unavailable` or `rejected`) is mapped to a
   *    tool_result via `#emitOutcome`: `unavailable` stays silent on the
   *    channel, `rejected` broadcasts. `ready` results are accumulated with their
   *    `run` closures for the second phase.
   * 2. Execute the `ready` list. If approval is required, all approval
   *    requests are fired in parallel and the closures are invoked in the
   *    order the approvals arrive (`Promise.race`). Otherwise the closures
   *    run sequentially in the model's order. Both paths respect the
   *    `cancelled` flag between items.
   */
  async #runTools(toolUses: ToolUseResult[], transformToolResult: TransformToolResult | undefined) {
    const requireApproval = this.durableProvider.config.requireToolApproval ?? false;
    const toolResults: ToolResultBlock[] = [];
    // A tool-scoped controller, distinct from the query's AbortController. ESC
    // aborts this to cancel the running tool without ending the query, so the
    // delivery turn still has the query's live signal. One controller per batch:
    // a cancel aborts every Exec tool in the batch (see Open decision 2).
    const toolController = new AbortController();

    // Phase 1: resolve and filter. Parse every tool_use once; route errors
    // to immediate tool_result blocks without requesting approval or
    // running any handler.
    const ready: Array<{ toolUse: ToolUseResult; run: (transform?: TransformToolResult) => Promise<ToolResultBlock> }> = [];
    for (const toolUse of toolUses) {
      const resolved = this.registry.resolve(toolUse.name, toolUse.input);
      if (resolved.kind !== 'ready') {
        toolResults.push(this.#emitOutcome(toolUse, resolved));
        continue;
      }
      // Capture the run closure; the wrapper invokes it and maps the outcome to a block.
      const resolvedRun = resolved.run;
      const toolUseRef = toolUse;
      ready.push({
        toolUse: toolUseRef,
        run: async (transform) => this.#emitOutcome(toolUseRef, await resolvedRun(transform, toolController.signal)),
      });
    }

    // Phase 2: execute the ready list.
    if (requireApproval) {
      const pending = ready.map(({ toolUse, run }) => {
        // The consumer addresses each streaming tool by its tool_use id and relinks
        // the approval to that object by requestId. Use the tool_use id as the requestId
        // so the relink succeeds (ids are unique within a batch; the id round-trips
        // through tool_approval_response unchanged).
        const requestId = toolUse.id;
        return {
          toolUse,
          run,
          promise: this.approval.request(requestId, () => {
            this.publisher.send({ type: 'tool_approval_request', requestId, name: toolUse.name, input: toolUse.input } satisfies SdkMessage);
          }),
        };
      });

      while (pending.length > 0) {
        if (this.approval.cancelled) {
          break;
        }
        const { toolUse, run, response, index } = await Promise.race(pending.map((item, idx) => item.promise.then((response) => ({ toolUse: item.toolUse, run: item.run, response, index: idx }))));
        pending.splice(index, 1);

        if (!response.approved) {
          const content = response.reason ?? 'Rejected by user, do not reattempt';
          this.logger.debug('tool_rejected', { name: toolUse.name, reason: content });
          this.publisher.send({ type: 'tool_result', id: toolUse.id, content, isError: true });
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: [{ type: 'text' as const, text: content }] });
          continue;
        }

        this.approval.toolRunStarted(toolController);
        try {
          toolResults.push(await run(transformToolResult));
        } finally {
          this.approval.toolRunFinished();
        }
      }
    } else {
      for (const { run } of ready) {
        if (this.approval.cancelled) {
          break;
        }
        this.approval.toolRunStarted(toolController);
        try {
          toolResults.push(await run(transformToolResult));
        } finally {
          this.approval.toolRunFinished();
        }
      }
    }
    return toolResults;
  }

  /** Map a tool outcome to its channel events and the tool_result block. The one place an
   * outcome becomes wire effects: `ok` carries the payload; every error category sets
   * `is_error` and broadcasts a `tool_error` for visibility, except `unavailable`, which
   * stays silent on the channel (only the error tool_result reaches the model). */
  #emitOutcome(toolUse: ToolUseResult, outcome: ToolOutcome): ToolResultBlock {
    const { id, name, input } = toolUse;
    if (outcome.kind === 'ok') {
      this.publisher.send({ type: 'tool_result', id, content: outcome.content, isError: false });
      return { type: 'tool_result', tool_use_id: id, content: [{ type: 'text' as const, text: outcome.content }, ...(outcome.blocks ?? [])] };
    }
    const text = outcomeMessage(outcome);
    this.logger.debug('tool_outcome', { name, category: outcome.kind, text });
    if (outcome.kind !== 'unavailable') {
      this.publisher.send({ type: 'tool_error', name, input, error: text });
    }
    this.publisher.send({ type: 'tool_result', id, content: text, isError: true });
    return { type: 'tool_result', tool_use_id: id, is_error: true, content: [{ type: 'text' as const, text }] };
  }
}

/** The model-facing string for a non-ok outcome, naming the category and the next action. */
function outcomeMessage(outcome: Exclude<ToolOutcome, { kind: 'ok' }>): string {
  switch (outcome.kind) {
    case 'rejected':
      return `Invalid input: ${outcome.reason}`;
    case 'refused':
      return `Refused: ${outcome.reason}`;
    case 'unavailable':
      return `Tool not found: ${outcome.name}`;
    case 'failed':
      return outcome.error;
    case 'cancelled':
      return `Tool execution cancelled by user after ${(outcome.elapsedMs / 1000).toFixed(1)}s`;
  }
}
