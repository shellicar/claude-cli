import { randomUUID } from 'node:crypto';
import type { RequestOptions } from 'node:http';
import type { MessagePort } from 'node:worker_threads';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import type { BetaCacheControlEphemeral } from '@anthropic-ai/sdk/resources/beta.mjs';
import { z } from 'zod';
import type { AnyToolDefinition, ChainedToolStore, ILogger, RunAgentQuery, SdkMessage } from '../public/types';
import { AgentChannel } from './AgentChannel';
import { ApprovalState } from './ApprovalState';
import { AGENT_SDK_PREFIX } from './consts';
import { MessageStream } from './MessageStream';
import type { ToolUseResult } from './types';

export class AgentRun {
  readonly #client: Anthropic;
  readonly #logger: ILogger | undefined;
  readonly #options: RunAgentQuery;
  readonly #channel: AgentChannel;
  readonly #approval: ApprovalState;

  constructor(client: Anthropic, logger: ILogger | undefined, options: RunAgentQuery) {
    this.#client = client;
    this.#logger = logger;
    this.#options = options;
    this.#approval = new ApprovalState();
    this.#channel = new AgentChannel((msg) => this.#approval.handle(msg));
  }

  get port(): MessagePort {
    return this.#channel.consumerPort;
  }

  async execute(): Promise<void> {
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = this.#options.messages.map((content) => ({
      role: 'user',
      content,
    }));
    const store: ChainedToolStore = new Map<string, unknown>();

    try {
      while (!this.#approval.cancelled) {
        this.#logger?.debug('messages', { messages });
        const stream = this.#getMessageStream(messages);
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

        if (result.stopReason !== 'tool_use' || result.toolUses.length === 0) {
          this.#channel.send({ type: 'done', stopReason: result.stopReason ?? 'end_turn' });
          break;
        }

        const toolResults = await this.#handleTools(result.toolUses, store);

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
        messages.push({ role: 'user', content: toolResults });
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
        input_schema: z.toJSONSchema(t.input_schema) as Anthropic.Tool['input_schema'],
        input_examples: t.input_examples,
      })),
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
    const tools: AnyToolDefinition[] = this.#options.tools;
    const requireApproval = this.#options.requireToolApproval ?? false;
    const toolResults: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];

    for (const toolUse of toolUses) {
      if (this.#approval.cancelled) break;

      if (requireApproval) {
        const requestId = randomUUID();
        const response = await this.#approval.request(requestId, () => {
          this.#channel.send({ type: 'tool_approval_request', requestId, name: toolUse.name, input: toolUse.input } satisfies SdkMessage);
        });

        if (!response.approved) {
          const content = response.reason ?? 'Tool use rejected';
          this.#logger?.debug('tool_rejected', { name: toolUse.name, reason: content });
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content });
          continue;
        }
      }

      const tool = tools.find((t) => t.name === toolUse.name);
      this.#logger?.debug('tool_call', { name: toolUse.name, input: toolUse.input, found: tool != null });
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

      const handler = tool.handler as (input: unknown, store: Map<string, unknown>) => Promise<unknown>;
      let toolOutput: unknown;
      try {
        toolOutput = await handler(parseResult.data, store);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.#logger?.debug('tool_handler_error', { name: toolUse.name, error: message });
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: message });
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
