import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaCompactionBlockParam, BetaContentBlockParam, BetaRedactedThinkingBlockParam, BetaServerToolUseBlockParam, BetaTextBlockParam, BetaThinkingBlockParam, BetaToolUseBlockParam } from '@anthropic-ai/sdk/resources/beta.mjs';
import { Clock } from '@js-joda/core';
import { type IStreamProcessor, ITurnRunner } from '../public/interfaces';
import type { ContentBlock, DurableConfig, ILogger, TurnInput } from '../public/types';
import { calculateBackoffDelay, defaultSleep, isRetryable, MAX_RETRIES } from './backoff';
import type { Conversation } from './Conversation';
import { formatClockStamp } from './clockStamp';
import type { IMessageStreamer } from './MessageStreamer';
import { buildRequestParams, type RequestBuilderOptions } from './RequestBuilder';
import type { MessageStreamResult } from './types';

/**
 * Long-lived turn runner. Constructed once at consumer setup with its
 * dependencies (`IMessageStreamer` and `IStreamProcessor`) and reused for
 * every turn of every query.
 *
 * A turn is one request-and-response cycle between the SDK and the Anthropic
 * API. Per call to `run` the runner:
 *
 * 1. Reads the wire view from `Conversation.cloneForRequest()`.
 * 2. Builds `RequestBuilderOptions` from the durable config plus the
 *    per-turn `systemReminder`.
 * 3. Calls the pure `buildRequestParams` function to get `{ body, headers }`.
 * 4. Merges the per-turn abort signal into `Anthropic.RequestOptions`.
 * 5. Calls the injected streamer to get the raw event iterable.
 * 6. Hands the iterable to the injected stream processor and awaits the
 *    assembled `MessageStreamResult`.
 * 7. Maps the result's internal `ContentBlock[]` to the wire-format
 *    `BetaContentBlockParam[]` and, if non-empty, pushes the assembled
 *    assistant message into the `Conversation`.
 * 8. Returns the full result so the query runner can read `stopReason`,
 *    `blocks` (for tool dispatch), and `usage` (for the channel).
 *
 * The runner does not subscribe or unsubscribe to any events per turn. The
 * `.on(...)` handlers on the injected `IStreamProcessor` were set by the
 * consumer once at SDK setup and fire naturally for every turn this runner
 * processes.
 *
 * Does NOT dispatch tools, construct `tool_result` messages, or decide
 * whether to loop: those are the query runner's responsibilities. The
 * runner's instance state is only its constructor-injected dependencies;
 * everything per-turn lives in `run`'s local variables.
 *
 * See `.claude/plans/sdk-refactor-playbook.md` for the original design.
 */
export class TurnRunner extends ITurnRunner {
  readonly #streamer: IMessageStreamer;
  readonly #processor: IStreamProcessor;
  readonly #logger: ILogger | undefined;
  readonly #sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly #random: () => number;
  readonly #clock: Clock;

  public constructor(streamer: IMessageStreamer, processor: IStreamProcessor, logger?: ILogger, sleep?: (ms: number, signal: AbortSignal) => Promise<void>, random?: () => number, clock: Clock = Clock.systemDefaultZone()) {
    super();
    this.#streamer = streamer;
    this.#processor = processor;
    this.#logger = logger;
    this.#sleep = sleep ?? defaultSleep;
    this.#random = random ?? Math.random;
    this.#clock = clock;
  }

  public async run(conversation: Conversation, durable: DurableConfig, turnInput: TurnInput): Promise<MessageStreamResult> {
    const compactEnabled = durable.compact?.enabled ?? false;
    const messages = conversation.cloneForRequest(compactEnabled);

    // Assemble per-turn reminders: git delta (one-shot, may be undefined on turn 2+) then clock stamp (always).
    const systemReminders: string[] = [];
    if (turnInput.systemReminder != null) {
      systemReminders.push(turnInput.systemReminder);
    }
    systemReminders.push(formatClockStamp(this.#clock));

    const builderOptions: RequestBuilderOptions = {
      model: durable.model,
      maxTokens: durable.maxTokens,
      thinking: durable.thinking,
      tools: durable.tools,
      serverTools: durable.serverTools,
      transformTool: durable.transformTool,
      betas: durable.betas,
      systemPrompts: durable.systemPrompts,
      systemReminders,
      compact: durable.compact,
      cacheTtl: durable.cacheTtl,
    };
    const { body, headers } = buildRequestParams(builderOptions, messages);

    this.#logger?.info('Sending request', body);

    const requestOptions: Anthropic.RequestOptions = {
      headers,
      signal: turnInput.abortSignal,
    };
    let result!: MessageStreamResult;
    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      try {
        const stream = this.#streamer.stream(body, requestOptions);
        result = await this.#processor.process(stream);
        break;
      } catch (err) {
        if (!isRetryable(err) || attempt > MAX_RETRIES) {
          throw err;
        }
        await this.#sleep(calculateBackoffDelay(attempt, this.#random), turnInput.abortSignal);
        if (turnInput.abortSignal.aborted) {
          // On abort, surface a standard cancel: throwIfAborted() throws signal.reason
          // (a DOMException when abort() has no reason). Deliberately not the SDK's
          // APIUserAbortError, and need not be.
          turnInput.abortSignal.throwIfAborted();
        }
      }
    }

    const assistantContent = result.blocks.map(mapBlock);
    if (assistantContent.length > 0) {
      conversation.push({ role: 'assistant', content: assistantContent });
    }

    return result;
  }
}

function mapBlock(b: ContentBlock): BetaContentBlockParam {
  switch (b.type) {
    case 'text':
      return { type: 'text' as const, text: b.text } satisfies BetaTextBlockParam;
    case 'thinking':
      return { type: 'thinking' as const, thinking: b.thinking, signature: b.signature } satisfies BetaThinkingBlockParam;
    case 'tool_use':
      return { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input } satisfies BetaToolUseBlockParam;
    case 'compaction':
      return { type: 'compaction' as const, content: b.content } satisfies BetaCompactionBlockParam;
    case 'server_tool_use': {
      const name = b.name as BetaServerToolUseBlockParam['name'];
      return { type: 'server_tool_use' as const, id: b.id, name, input: b.input } satisfies BetaServerToolUseBlockParam;
    }
    case 'redacted_thinking':
      return { type: 'redacted_thinking' as const, data: b.data } satisfies BetaRedactedThinkingBlockParam;
    case 'web_search_tool_result':
    case 'web_fetch_tool_result':
    case 'code_execution_tool_result':
    case 'bash_code_execution_tool_result':
    case 'text_editor_code_execution_tool_result':
    case 'tool_search_tool_result':
    case 'mcp_tool_result':
      return { type: b.type, tool_use_id: b.toolUseId, content: b.content } as BetaContentBlockParam;
  }
}
