import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaCompactionBlockParam, BetaContentBlockParam, BetaTextBlockParam, BetaThinkingBlockParam, BetaToolUseBlockParam } from '@anthropic-ai/sdk/resources/beta.mjs';
import { type IStreamProcessor, ITurnRunner } from '../public/interfaces';
import type { DurableConfig, ILogger, TurnInput } from '../public/types';
import type { Conversation } from './Conversation';
import type { IMessageStreamer } from './MessageStreamer';
import { buildRequestParams, type RequestBuilderOptions } from './RequestBuilder';
import type { ContentBlock, MessageStreamResult } from './types';

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

  public constructor(streamer: IMessageStreamer, processor: IStreamProcessor, logger?: ILogger) {
    super();
    this.#streamer = streamer;
    this.#processor = processor;
    this.#logger = logger;
  }

  public async run(conversation: Conversation, durable: DurableConfig, turnInput: TurnInput): Promise<MessageStreamResult> {
    const compactEnabled = durable.compact?.enabled ?? false;
    const messages = conversation.cloneForRequest(compactEnabled);

    const builderOptions: RequestBuilderOptions = {
      model: durable.model,
      maxTokens: durable.maxTokens,
      thinking: durable.thinking,
      tools: durable.tools,
      serverTools: durable.serverTools,
      transformTool: durable.transformTool,
      betas: durable.betas,
      systemPrompts: durable.systemPrompts,
      systemReminder: turnInput.systemReminder,
      compact: durable.compact,
      cacheTtl: durable.cacheTtl,
    };
    const { body, headers } = buildRequestParams(builderOptions, messages);

    this.#logger?.info('Sending request', body);

    const requestOptions: Anthropic.RequestOptions = {
      headers,
      signal: turnInput.abortSignal,
    };
    const stream = this.#streamer.stream(body, requestOptions);
    const result = await this.#processor.process(stream);

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
  }
}
