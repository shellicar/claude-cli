import { randomUUID } from 'node:crypto';
import type { MessagePort } from 'node:worker_threads';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import type { BetaCacheControlEphemeral, BetaClearThinking20251015Edit, BetaClearToolUses20250919Edit, BetaCompact20260112Edit, BetaCompactionBlockParam, BetaContextManagementConfig, BetaTextBlockParam, BetaThinkingBlockParam, BetaToolUnion, BetaToolUseBlockParam } from '@anthropic-ai/sdk/resources/beta.mjs';
import { AnthropicBeta } from '../public/enums';
import type { AnyToolDefinition, ILogger, RunAgentQuery, SdkMessage } from '../public/types';
import { AgentChannel } from './AgentChannel';
import { ApprovalState } from './ApprovalState';
import type { ConversationHistory } from './ConversationHistory';
import { AGENT_SDK_PREFIX } from './consts';
import { MessageStream } from './MessageStream';
import { calculateCost, getContextWindow } from './pricing';
import type { ContentBlock, MessageStreamResult, ToolUseResult } from './types';

export class AgentRun {
  readonly #client: Anthropic;
  readonly #logger: ILogger | undefined;
  readonly #options: RunAgentQuery;
  readonly #history: ConversationHistory;
  readonly #channel: AgentChannel;
  readonly #approval: ApprovalState;
  readonly #abortController: AbortController;

  public constructor(client: Anthropic, logger: ILogger | undefined, options: RunAgentQuery, history: ConversationHistory) {
    this.#client = client;
    this.#logger = logger;
    this.#options = options;
    this.#history = history;
    this.#abortController = new AbortController();
    this.#approval = new ApprovalState();
    this.#channel = new AgentChannel((msg) => {
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
    this.#history.push(...this.#options.messages.map((content) => ({ role: 'user' as const, content })));

    try {
      while (!this.#approval.cancelled) {
        this.#logger?.debug('messages', { messages: this.#history.messages.length });
        const stream = this.#getMessageStream(this.#history.messages);
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

        const cacheTtl = this.#options.cacheTtl ?? '5m';
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
          // if (result.contextManagementOccurred) {
          //   result.contextManagementOccurred = false;
          //   this.#logger?.warn('stop_reason was tool_use but no tool uses accumulated — retrying after context management');
          //   continue;
          // }
          this.#logger?.warn('stop_reason was tool_use but no tool uses accumulated — no context management, giving up');
          this.#channel.send({ type: 'error', message: 'stop_reason was tool_use but no tool uses found' });
          break;
        }

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

  #getMessageStream(messages: Anthropic.Beta.Messages.BetaMessageParam[]) {
    const tools: BetaToolUnion[] = this.#options.tools.map(
      (t) =>
        ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema.toJSONSchema({ target: 'draft-07', io: 'input' }) as Anthropic.Tool['input_schema'],
          input_examples: t.input_examples,
        }) satisfies BetaToolUnion,
    );

    const betas = resolveCapabilities(this.#options.betas, AnthropicBeta);

    const context_management: BetaContextManagementConfig = {
      edits: [],
    };
    if (betas[AnthropicBeta.ContextManagement]) {
      context_management.edits?.push({ type: 'clear_thinking_20251015' } satisfies BetaClearThinking20251015Edit);
      context_management.edits?.push({ type: 'clear_tool_uses_20250919' } satisfies BetaClearToolUses20250919Edit);
    }
    if (betas[AnthropicBeta.Compact]) {
      context_management.edits?.push({ type: 'compact_20260112', pause_after_compaction: true, trigger: { type: 'input_tokens', value: 125000 } } satisfies BetaCompact20260112Edit);
    }

    const body = {
      model: this.#options.model,
      max_tokens: this.#options.maxTokens,
      tools,
      context_management,
      cache_control: { type: 'ephemeral', scope: 'global' } as BetaCacheControlEphemeral,
      system: [{ type: 'text', text: AGENT_SDK_PREFIX }],
      messages,
      thinking: { type: 'adaptive' },
      stream: true,
    } satisfies BetaMessageStreamParams;

    const anthropicBetas = Object.entries(betas)
      .filter(([, enabled]) => enabled)
      .map(([beta]) => beta)
      .join(',');

    const requestOptions = {
      headers: { 'anthropic-beta': anthropicBetas },
      signal: this.#abortController.signal,
    } satisfies Anthropic.RequestOptions;

    this.#logger?.info('Sending request', body);

    return this.#client.beta.messages.stream(body, requestOptions);
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
          const content = response.reason ?? 'Tool use rejected';
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
      const transformed = this.#options.transformToolResult
        ? this.#options.transformToolResult(toolUse.name, toolOutput)
        : toolOutput;
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

function resolveCapabilities<T extends string>(partial: Partial<Record<T, boolean>> | undefined, enumObj: Record<string, T>): Record<T, boolean> {
  const result = {} as Record<T, boolean>;
  for (const key of Object.values(enumObj)) {
    result[key] = partial?.[key] ?? false;
  }
  return result;
}
