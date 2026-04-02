import EventEmitter from 'node:events';
import type { RequestOptions } from 'node:http';
import { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import type { BetaCacheControlEphemeral } from '@anthropic-ai/sdk/resources/beta.mjs';
import { z } from 'zod';
import { AGENT_SDK_PREFIX } from '../private/consts';
import { MessageStream } from '../private/MessageStream';
import type { ToolUseResult } from '../private/types';
import type { AgentEvents, AnthropicAgentOptions, AnyToolDefinition, ChainedToolStore, ILogger, RunAgentQuery } from './types';

export class AnthropicAgent extends EventEmitter<AgentEvents> {
  readonly #client: Anthropic;
  readonly #logger: ILogger | undefined;

  public constructor(options: AnthropicAgentOptions) {
    super();
    this.#logger = options.logger;
    this.#client = new Anthropic({ apiKey: options.apiKey });
  }

  public async runAgent(options: RunAgentQuery): Promise<void> {
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = options.messages.map((content) => ({
      role: 'user',
      content,
    }));

    const store: ChainedToolStore = new Map<string, unknown>();

    while (true) {
      this.#logger?.debug('messages', { messages });
      const stream = this.getMessageStream(options, messages);
      this.#logger?.info('Processing messages');

      const messageStream = new MessageStream(this.#logger);
      messageStream.on('message_start', () => this.emit('message_start'));
      messageStream.on('message_text', (text) => this.emit('message_text', text));
      messageStream.on('message_stop', () => this.emit('message_end'));

      let result: Awaited<ReturnType<MessageStream['process']>>;
      try {
        result = await messageStream.process(stream);
      } catch (err) {
        if (err instanceof Error) {
          this.emit('error', err);
        }
        return;
      }

      if (result.stopReason !== 'tool_use' || result.toolUses.length === 0) {
        break;
      }

      const toolResults = this.handleTools(options.tools, result.toolUses, store);

      messages.push({
        role: 'assistant',
        content: [
          ...(result.text.length > 0 ? [{ type: 'text' as const, text: result.text }] : []),
          ...result.toolUses.map((t) => ({
            type: 'tool_use' as const,
            id: t.id,
            name: t.name,
            input: t.input,
          })),
        ],
      });
      messages.push({
        role: 'user',
        content: toolResults,
      });
    }
  }

  private getMessageStream(options: RunAgentQuery, messages: Anthropic.Beta.Messages.BetaMessageParam[]) {
    const body = {
      model: options.model,
      max_tokens: options.maxTokens,
      tools: options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: z.toJSONSchema(t.input_schema) as Anthropic.Tool['input_schema'],
        input_examples: t.input_examples,
      })),
      cache_control: { type: 'ephemeral', scope: 'global' } as BetaCacheControlEphemeral,
      system: [{ type: 'text', text: AGENT_SDK_PREFIX }],
      messages,
      thinking: {
        type: 'adaptive',
      },
      stream: true,
    } satisfies BetaMessageStreamParams;

    const betas = Object.entries(options.betas ?? {})
      .filter(([, enabled]) => enabled)
      .map(([beta]) => beta)
      .join(',');

    const requestOptions = {
      headers: {
        'anthropic-beta': betas,
      },
    } satisfies RequestOptions;

    this.#logger?.info('Sending request', {
      model: options.model,
      max_tokens: options.maxTokens,
      tools: options.tools.map((t) => ({
        name: t.name,
        description: t.description,
      })),
      cache_control: { type: 'ephemeral', scope: 'global' } as BetaCacheControlEphemeral,
      thinking: {
        type: 'adaptive',
      },
      stream: true,
      headers: requestOptions.headers,
    });
    return this.#client.beta.messages.stream(body, requestOptions);
  }

  private handleTools(tools: AnyToolDefinition[], toolUses: ToolUseResult[], store: Map<string, unknown>) {
    const toolResults: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const tool = tools.find((t) => t.name === toolUse.name);
      this.#logger?.debug('tool_call', { name: toolUse.name, input: toolUse.input, found: tool != null });
      if (tool == null) {
        const content = `Tool not found: ${toolUse.name}`;
        this.#logger?.debug('tool_result_error', { name: toolUse.name, content });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: true,
          content,
        });
        continue;
      }
      const parseResult = tool.input_schema.safeParse(toolUse.input);
      if (!parseResult.success) {
        this.#logger?.debug('tool_parse_error', { name: toolUse.name, error: parseResult.error });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: true,
          content: `Invalid input: ${parseResult.error.message}`,
        });
        continue;
      }
      const handler = tool.handler as (input: unknown, store: Map<string, unknown>) => unknown;
      let toolOutput: unknown;
      try {
        toolOutput = handler(parseResult.data, store);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.#logger?.debug('tool_handler_error', { name: toolUse.name, error: message });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: true,
          content: message,
        });
        continue;
      }
      this.#logger?.debug('tool_result', { name: toolUse.name, output: toolOutput });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput),
      });
    }
    return toolResults;
  }
}
