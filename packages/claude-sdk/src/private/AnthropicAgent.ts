import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta.js';
import versionJson from '@shellicar/build-version/version';
import { IAnthropicAgent } from '../public/interfaces';
import type { AnthropicAgentOptions, ILogger, RunAgentQuery, RunAgentResult } from '../public/types';
import { AgentChannelFactory } from './AgentChannel';
import { AgentRun } from './AgentRun';
import { ConversationStore } from './ConversationStore';
import { AnthropicMessageStreamer } from './MessageStreamer';
import { customFetch } from './http/customFetch';
import { TokenRefreshingAnthropic } from './http/TokenRefreshingAnthropic';

export class AnthropicAgent extends IAnthropicAgent {
  readonly #streamer: AnthropicMessageStreamer;
  readonly #channelFactory: AgentChannelFactory;
  readonly #logger: ILogger | undefined;
  readonly #history: ConversationStore;

  public constructor(options: AnthropicAgentOptions) {
    super();
    this.#logger = options.logger;
    const defaultHeaders = {
      'user-agent': `@shellicar/claude-sdk/${versionJson.version}`,
    };
    const client = new TokenRefreshingAnthropic({
      authToken: options.authToken,
      fetch: customFetch(options.logger),
      logger: options.logger,
      defaultHeaders,
    });
    this.#streamer = new AnthropicMessageStreamer(client);
    this.#channelFactory = new AgentChannelFactory();
    this.#history = new ConversationStore(options.historyFile);
  }

  public runAgent(options: RunAgentQuery): RunAgentResult {
    const run = new AgentRun(this.#streamer, this.#channelFactory, this.#logger, options, this.#history);
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
