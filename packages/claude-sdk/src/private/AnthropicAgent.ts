import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta.js';
import { IAnthropicAgent } from '../public/interfaces';
import type { AnthropicAgentOptions, ILogger, RunAgentQuery, RunAgentResult } from '../public/types';
import { AgentChannelFactory } from './AgentChannel';
import { AgentRun } from './AgentRun';
import { AnthropicClient } from './AnthropicClient';
import { ConversationStore } from './ConversationStore';
import type { IMessageStreamer } from './MessageStreamer';

export class AnthropicAgent extends IAnthropicAgent {
  readonly #client: IMessageStreamer;
  readonly #channelFactory: AgentChannelFactory;
  readonly #logger: ILogger | undefined;
  readonly #history: ConversationStore;

  public constructor(options: AnthropicAgentOptions) {
    super();
    this.#logger = options.logger;
    this.#client = new AnthropicClient({
      authToken: options.authToken,
      logger: options.logger,
    });
    this.#channelFactory = new AgentChannelFactory();
    this.#history = new ConversationStore(options.historyFile);
  }

  public runAgent(options: RunAgentQuery): RunAgentResult {
    const run = new AgentRun(this.#client, this.#channelFactory, this.#logger, options, this.#history);
    return { port: run.port, done: run.execute() };
  }

  public getHistory(): BetaMessageParam[] {
    return this.#history.messages;
  }

  public loadHistory(messages: BetaMessageParam[]): void {
    for (const msg of messages) {
      this.#history.push(msg);
    }
  }

  public injectContext(msg: BetaMessageParam, opts?: { id?: string }): void {
    this.#history.push(msg, opts);
  }

  public removeContext(id: string): boolean {
    return this.#history.remove(id);
  }
}
