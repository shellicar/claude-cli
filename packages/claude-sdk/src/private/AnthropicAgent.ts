import { Anthropic } from '@anthropic-ai/sdk';
import type { AnthropicAgentOptions, ILogger, RunAgentQuery, RunAgentResult } from '../public/types';
import { AgentRun } from './AgentRun';

export class AnthropicAgent {
  readonly #client: Anthropic;
  readonly #logger: ILogger | undefined;

  public constructor(options: AnthropicAgentOptions) {
    this.#logger = options.logger;
    this.#client = new Anthropic({ apiKey: options.apiKey });
  }

  public runAgent(options: RunAgentQuery): RunAgentResult {
    const run = new AgentRun(this.#client, this.#logger, options);
    return { port: run.port, done: run.execute() };
  }
}
