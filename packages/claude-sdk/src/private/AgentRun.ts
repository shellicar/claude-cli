import { randomUUID } from 'node:crypto';
import type { MessagePort } from 'node:worker_threads';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaCompactionBlockParam, BetaTextBlockParam, BetaThinkingBlockParam, BetaToolUseBlockParam } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { AnyToolDefinition, ILogger, RunAgentQuery, SdkMessage } from '../public/types';
import type { IAgentChannel, IAgentChannelFactory } from './AgentChannel';
import { ApprovalState } from './ApprovalState';
import type { ConversationStore } from './ConversationStore';
import { MessageStream } from './MessageStream';
import type { IMessageStreamer } from './MessageStreamer';
import { calculateCost, getContextWindow } from './pricing';
import { buildRequestParams, type RequestBuilderOptions } from './RequestBuilder';
import type { ContentBlock, MessageStreamResult, ToolUseResult } from './types';

export class AgentRun {
  readonly #streamer: IMessageStreamer;
  readonly #logger: ILogger | undefined;
  readonly #options: RunAgentQuery;
  readonly #history: ConversationStore;
  readonly #channel: IAgentChannel;
  readonly #approval: ApprovalState;
  readonly #abortController: AbortController;

  public constructor(streamer: IMessageStreamer, channelFactory: IAgentChannelFactory, logger: ILogger | undefined, options: RunAgentQuery, history: ConversationStore) {
    this.#streamer = streamer;
    this.#logger = logger;
    this.#options = options;
    this.#history = history;
    this.#abortController = new AbortController();
    this.#approval = new ApprovalState();
    this.#channel = channelFactory.create((msg) => {
      if (msg.type === 'cancel') {
        this.#abortController.abort();
      }
      this.#approval.handle(msg);
    });
  }

  public get port(): MessagePort {
    return this.#channel.consumerPort;
  }

  public async execute(): Promise<void> {
    const cachedReminders = this.#options.cachedReminders;
    // Inject when there are no user messages in history — covers both a fresh
    // conversation and a post-compaction state where the original first user
    // message (which held the cached reminders) has been dropped by the API.
    const injectReminders = cachedReminders != null && cachedReminders.length > 0 && !this.#history.messages.some((m) => m.role === 'user');

    let isFirst = true;
    for (const content of this.#options.messages) {
      if (isFirst && injectReminders) {
        const reminderBlocks: BetaTextBlockParam[] = cachedReminders.map((text, i, arr) => ({
          type: 'text' as const,
          text: `<system-reminder>\n${text}\n</system-reminder>\n${i === arr.length - 1 ? '\n' : ''}`,
        }));
        this.#history.push({ role: 'user', content: [...reminderBlocks, { type: 'text' as const, text: content }] });
      } else {
        this.#history.push({ role: 'user', content });
      }
      isFirst = false;
    }

    try {
      let systemReminder = this.#options.systemReminder;
      let emptyToolUseRetries = 0;
      while (!this.#approval.cancelled) {
        this.#logger?.debug('messages', { messages: this.#history.messages.length });

        const userMessages = this.#history.messages.filter((m) => m.role === 'user').length;
        const assistantMessages = this.#history.messages.filter((m) => m.role === 'assistant').length;
        const thinkingBlocks = this.#history.messages
          .filter((m) => m.role === 'assistant')
          .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
          .filter((b) => b.type === 'thinking').length;
        const systemPromptCount = 1 + (this.#options.systemPrompts?.length ?? 0);
        this.#channel.send({ type: 'query_summary', systemPrompts: systemPromptCount, userMessages, assistantMessages, thinkingBlocks, systemReminder });

        const stream = this.#getMessageStream(this.#history.messages, systemReminder);
        systemReminder = undefined;
        this.#logger?.info('Processing messages');

        const messageStream = new MessageStream(this.#logger);
        messageStream.on('message_start', () => this.#channel.send({ type: 'message_start' }));
        messageStream.on('message_text', (text) => this.#channel.send({ type: 'message_text', text }));
        messageStream.on('thinking_text', (text) => this.#channel.send({ type: 'message_thinking', text }));
        messageStream.on('message_stop', () => this.#channel.send({ type: 'message_end' }));
        messageStream.on('compaction_start', () => this.#channel.send({ type: 'message_compaction_start' }));
        messageStream.on('compaction_complete', (summary) => this.#channel.send({ type: 'message_compaction', summary }));

        let result: Awaited<ReturnType<MessageStream['process']>>;
        try {
          result = await messageStream.process(stream);
        } catch (err) {
          if (err instanceof Error) {
            this.#channel.send({ type: 'error', message: err.message });
          }
          return;
        }

        const cacheTtl = this.#options.cacheTtl ?? CacheTtl.OneHour;
        const costUsd = calculateCost(result.usage, this.#options.model, cacheTtl);
        const contextWindow = getContextWindow(this.#options.model);
        this.#channel.send({ type: 'message_usage', ...result.usage, costUsd, contextWindow } satisfies SdkMessage);

        const toolUses = result.blocks.filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use');

        if (result.stopReason !== 'tool_use') {
          this.handleAssistantMessages(result);
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
        this.handleAssistantMessages(result);
        const toolResults = await this.#handleTools(toolUses);
        this.#history.push({ role: 'user', content: toolResults });
      }
    } finally {
      this.#channel.close();
    }
  }

  private handleAssistantMessages(result: MessageStreamResult) {
    const mapBlock = (b: ContentBlock): Anthropic.Beta.Messages.BetaContentBlockParam => {
      switch (b.type) {
        case 'text': {
          return { type: 'text' as const, text: b.text } satisfies BetaTextBlockParam;
        }
        case 'thinking': {
          return { type: 'thinking' as const, thinking: b.thinking, signature: b.signature } satisfies BetaThinkingBlockParam;
        }
        case 'tool_use': {
          return { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input } satisfies BetaToolUseBlockParam;
        }
        case 'compaction': {
          return { type: 'compaction' as const, content: b.content } satisfies BetaCompactionBlockParam;
        }
      }
    };

    const assistantContent = result.blocks.map(mapBlock);
    if (assistantContent.length > 0) {
      this.#history.push({ role: 'assistant', content: assistantContent });
    }
  }

  #getMessageStream(messages: Anthropic.Beta.Messages.BetaMessageParam[], systemReminder: string | undefined) {
    const builderOptions: RequestBuilderOptions = {
      model: this.#options.model,
      maxTokens: this.#options.maxTokens,
      thinking: this.#options.thinking,
      tools: this.#options.tools,
      betas: this.#options.betas,
      systemPrompts: this.#options.systemPrompts,
      systemReminder,
      pauseAfterCompact: this.#options.pauseAfterCompact,
      compactInputTokens: this.#options.compactInputTokens,
      cacheTtl: this.#options.cacheTtl,
    };
    const { body, headers } = buildRequestParams(builderOptions, messages);
    const requestOptions: Anthropic.RequestOptions = {
      headers,
      signal: this.#abortController.signal,
    };
    this.#logger?.info('Sending request', body);
    return this.#streamer.stream(body, requestOptions);
  }

  async #handleTools(toolUses: ToolUseResult[]): Promise<Anthropic.Beta.Messages.BetaToolResultBlockParam[]> {
    const requireApproval = this.#options.requireToolApproval ?? false;
    const toolResults: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];

    // Resolve tools and validate input first. Error immediately without requesting approval.
    const resolved = [];
    for (const toolUse of toolUses) {
      const tool = this.#options.tools.find((t) => t.name === toolUse.name);
      if (tool == null) {
        const content = `Tool not found: ${toolUse.name}`;
        this.#logger?.debug('tool_result_error', { name: toolUse.name, content });
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content });
        continue;
      }
      const parseResult = tool.input_schema.safeParse(toolUse.input);
      if (!parseResult.success) {
        const error = parseResult.error.message;
        this.#logger?.debug('tool_parse_error', { name: toolUse.name, error: parseResult.error });
        this.#channel.send({ type: 'tool_error', name: toolUse.name, input: toolUse.input, error });
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: `Invalid input: ${error}` });
        continue;
      }
      resolved.push({ toolUse, tool, input: parseResult.data });
    }

    if (requireApproval) {
      // Send all approval requests to the consumer at once
      const pending = resolved.map(({ toolUse, tool, input }) => {
        const requestId = randomUUID();
        return {
          toolUse,
          tool,
          input,
          promise: this.#approval.request(requestId, () => {
            this.#channel.send({ type: 'tool_approval_request', requestId, name: toolUse.name, input: toolUse.input } satisfies SdkMessage);
          }),
        };
      });

      // Execute tools in the order approvals arrive
      while (pending.length > 0) {
        if (this.#approval.cancelled) {
          break;
        }
        const { toolUse, tool, input, response, index } = await Promise.race(pending.map((item, idx) => item.promise.then((response) => ({ toolUse: item.toolUse, tool: item.tool, input: item.input, response, index: idx }))));
        pending.splice(index, 1);

        if (!response.approved) {
          const content = response.reason ?? 'Rejected by user, do not reattempt';
          this.#logger?.debug('tool_rejected', { name: toolUse.name, reason: content });
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content });
          continue;
        }

        toolResults.push(await this.#executeTool(toolUse, tool, input));
      }
    } else {
      for (const { toolUse, tool, input } of resolved) {
        if (this.#approval.cancelled) {
          break;
        }
        toolResults.push(await this.#executeTool(toolUse, tool, input));
      }
    }

    return toolResults;
  }

  async #executeTool(toolUse: ToolUseResult, tool: AnyToolDefinition, input: unknown): Promise<Anthropic.Beta.Messages.BetaToolResultBlockParam> {
    this.#logger?.debug('tool_call', { name: toolUse.name, input: toolUse.input });
    const handler = tool.handler as (input: unknown) => Promise<unknown>;
    try {
      const toolOutput = await handler(input);
      this.#logger?.debug('tool_result', { name: toolUse.name, output: toolOutput });
      const transformed = this.#options.transformToolResult ? this.#options.transformToolResult(toolUse.name, toolOutput) : toolOutput;
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: typeof transformed === 'string' ? transformed : JSON.stringify(transformed),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#logger?.debug('tool_handler_error', { name: toolUse.name, error: message });
      this.#channel.send({ type: 'tool_error', name: toolUse.name, input: toolUse.input, error: message });
      return { type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: message };
    }
  }
}
