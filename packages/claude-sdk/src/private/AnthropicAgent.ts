import { Anthropic, type ClientOptions } from '@anthropic-ai/sdk';
import versionJson from '@shellicar/build-version/version';
import { IAnthropicAgent } from '../public/interfaces';
import type { AnthropicAgentOptions, ILogger, RunAgentQuery, RunAgentResult } from '../public/types';
import { AgentRun } from './AgentRun';
import { ConversationHistory } from './ConversationHistory';
import { customFetch } from './http/customFetch';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta.js';

export class AnthropicAgent extends IAnthropicAgent {
  readonly #client: Anthropic;
  readonly #logger: ILogger | undefined;
  readonly #history: ConversationHistory;

  public constructor(options: AnthropicAgentOptions) {
    super();
    this.#logger = options.logger;
    const defaultHeaders = {
      'user-agent': `@shellicar/claude-sdk/${versionJson.version}`,
    };
    const clientOptions = {
      authToken: `${options.apiKey}`,
      fetch: customFetch(options.logger),
      logger: options.logger,
      defaultHeaders,
    } satisfies ClientOptions;
    this.#client = new Anthropic(clientOptions);
    this.#history = new ConversationHistory(options.historyFile);
  }

  public runAgent(options: RunAgentQuery): RunAgentResult {
    const run = new AgentRun(this.#client, this.#logger, options, this.#history);
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
