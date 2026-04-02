import EventEmitter from 'node:events';
import type { AgentEvents, AnthropicAgentOptions, ILogger, RunAgentQuery } from './types';
import { Anthropic } from '@anthropic-ai/sdk';
import { AGENT_SDK_PREFIX } from '../private/consts';
import { MessageStream } from './MessageStream';

export class AnthropicAgent extends EventEmitter<AgentEvents> {
  readonly #client: Anthropic;
  readonly #logger: ILogger | undefined;

  public constructor(options: AnthropicAgentOptions) {
    super();
    this.#logger = options.logger;
    this.#client = new Anthropic({ apiKey: options.apiKey });
  }

  public async runAgent(options: RunAgentQuery): Promise<void> {
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = options.messages.map(content => ({
      role: 'user',
      content,
    }));

    while (true) {
      const stream = this.#client.beta.messages.stream(
        {
          model: options.model,
          max_tokens: 8096,
          tools: options.tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: { type: 'object' as const, properties: {}, required: [] },
          })),
          system: [{ type: 'text', text: AGENT_SDK_PREFIX }],
          messages,
          stream: true,
        },
        { headers: { 'anthropic-beta': 'oauth-2025-04-20' } },
      );

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

      const toolResults: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const toolUse of result.toolUses) {
        const tool = options.tools.find(t => t.name === toolUse.name);
        if (tool != null) {
          const toolOutput = tool.handler();
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput),
          });
        }
      }

      messages.push({
        role: 'assistant',
        content: [
          ...(result.text.length > 0 ? [{ type: 'text' as const, text: result.text }] : []),
          ...result.toolUses.map(t => ({
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
}
