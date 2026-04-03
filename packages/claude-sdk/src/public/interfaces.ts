import type { RunAgentQuery, RunAgentResult } from './types';

export abstract class IAnthropicAgent {
  public abstract runAgent(options: RunAgentQuery): RunAgentResult;
}
