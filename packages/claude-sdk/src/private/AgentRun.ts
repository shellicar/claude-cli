import { randomUUID } from 'node:crypto';
import type { RequestOptions } from 'node:http';
import type { MessagePort } from 'node:worker_threads';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import type { BetaCacheControlEphemeral, BetaCompactionBlockParam, BetaTextBlockParam, BetaThinkingBlockParam, BetaToolUseBlock, BetaToolUseBlockParam } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { AnyToolDefinition, ChainedToolStore, ILogger, RunAgentQuery, SdkMessage } from '../public/types';
import { AgentChannel } from './AgentChannel';
import { ApprovalState } from './ApprovalState';
import type { ConversationHistory } from './ConversationHistory';
import { AGENT_SDK_PREFIX } from './consts';
import { MessageStream } from './MessageStream';
import type { ToolUseResult } from './types';

export class AgentRun {
  readonly #client: Anthropic;
  readonly #logger: ILogger | undefined;
  readonly #options: RunAgentQuery;
  readonly #history: ConversationHistory;
  readonly #channel: AgentChannel;
  readonly #approval: ApprovalState;

  public constructor(client: Anthropic, logger: ILogger | undefined, options: RunAgentQuery, history: ConversationHistory) {
    this.#client = client;
    this.#logger = logger;
    this.#options = options;
    this.#history = history;
    this.#approval = new ApprovalState();
    this.#channel = new AgentChannel((msg) => this.#approval.handle(msg));
  }

  public get port(): MessagePort {
    return this.#channel.consumerPort;
  }

  public async execute(): Promise<void> {
    this.#history.push(...this.#options.messages.map((content) => ({ role: 'user' as const, content })));
    const store: ChainedToolStore = new Map<string, unknown>();

    try {
      while (!this.#approval.cancelled) {
        this.#logger?.debug('messages', { messages: this.#history.messages.length });
        const stream = this.#getMessageStream(this.#history.messages);
        this.#logger?.info('Processing messages');

        const messageStream = new MessageStream(this.#logger);
        messageStream.on('message_start', () => this.#channel.send({ type: 'message_start' }));
        messageStream.on('message_text', (text) => this.#channel.send({ type: 'message_text', text }));
        messageStream.on('message_stop', () => this.#channel.send({ type: 'message_end' }));

        let result: Awaited<ReturnType<MessageStream['process']>>;
        try {
          result = await messageStream.process(stream);
        } catch (err) {
          if (err instanceof Error) {
            this.#channel.send({ type: 'error', message: err.message });
          }
          return;
        }

        const assistantContent: Anthropic.Beta.Messages.BetaContentBlockParam[] = result.blocks.map((b) => {
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
        });
        if (assistantContent.length > 0) {
          this.#history.push({ role: 'assistant', content: assistantContent });
        }

        const toolUses = result.blocks.filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use');

        if (result.stopReason !== 'tool_use') {
          this.#channel.send({ type: 'done', stopReason: result.stopReason ?? 'end_turn' });
          break;
        }

        if (toolUses.length === 0) {
          this.#logger?.warn('stop_reason was tool_use but no tool uses were accumulated — possible stream parsing issue');
          this.#channel.send({ type: 'error', message: 'stop_reason was tool_use but no tool uses found' });
          break;
        }

        const toolResults = await this.#handleTools(toolUses, store);
        this.#history.push({ role: 'user', content: toolResults });
      }
    } finally {
      this.#channel.close();
    }
  }

  #getMessageStream(messages: Anthropic.Beta.Messages.BetaMessageParam[]) {
    const body = {
      model: this.#options.model,
      max_tokens: this.#options.maxTokens,
      tools: this.#options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema.toJSONSchema({ target: 'draft-07', io: 'input' }) as Anthropic.Tool['input_schema'],
        input_examples: t.input_examples,
      })),
      context_management: {
        edits: [{ type: 'clear_thinking_20251015' }, { type: 'clear_tool_uses_20250919' }, { type: 'compact_20260112', trigger: { type: 'input_tokens', value: 80000 } }],
      },
      cache_control: { type: 'ephemeral', scope: 'global' } as BetaCacheControlEphemeral,
      system: [{ type: 'text', text: AGENT_SDK_PREFIX }],
      messages,
      thinking: { type: 'adaptive' },
      stream: true,
    } satisfies BetaMessageStreamParams;

    const betas = Object.entries(this.#options.betas ?? {})
      .filter(([, enabled]) => enabled)
      .map(([beta]) => beta)
      .join(',');

    const requestOptions = {
      headers: { 'anthropic-beta': betas },
    } satisfies RequestOptions;

    this.#logger?.info('Sending request', {
      model: this.#options.model,
      max_tokens: this.#options.maxTokens,
      tools: this.#options.tools.map((t) => ({ name: t.name, description: t.description })),
      cache_control: { type: 'ephemeral', scope: 'global' } as BetaCacheControlEphemeral,
      thinking: { type: 'adaptive' },
      stream: true,
      headers: requestOptions.headers,
    });

    return this.#client.beta.messages.stream(body, requestOptions);
  }

  async #handleTools(toolUses: ToolUseResult[], store: ChainedToolStore): Promise<Anthropic.Beta.Messages.BetaToolResultBlockParam[]> {
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
        this.#logger?.debug('tool_parse_error', { name: toolUse.name, error: parseResult.error });
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: `Invalid input: ${parseResult.error.message}` });
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

        toolResults.push(await this.#executeTool(toolUse, tool, input, store));
      }
    } else {
      for (const { toolUse, tool, input } of resolved) {
        if (this.#approval.cancelled) {
          break;
        }
        toolResults.push(await this.#executeTool(toolUse, tool, input, store));
      }
    }

    return toolResults;
  }

  async #executeTool(toolUse: ToolUseResult, tool: AnyToolDefinition, input: unknown, store: ChainedToolStore): Promise<Anthropic.Beta.Messages.BetaToolResultBlockParam> {
    this.#logger?.debug('tool_call', { name: toolUse.name, input: toolUse.input });
    const handler = tool.handler as (input: unknown, store: Map<string, unknown>) => Promise<unknown>;
    try {
      const toolOutput = await handler(input, store);
      this.#logger?.debug('tool_result', { name: toolUse.name, output: toolOutput });
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#logger?.debug('tool_handler_error', { name: toolUse.name, error: message });
      return { type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: message };
    }
  }
}
