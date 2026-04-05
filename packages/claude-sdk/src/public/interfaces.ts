import type { JsonObject, RunAgentQuery, RunAgentResult } from './types';

export abstract class IAnthropicAgent {
  public abstract runAgent(options: RunAgentQuery): RunAgentResult;
  public abstract getHistory(): JsonObject[];
  public abstract loadHistory(messages: JsonObject[]): void;
}
