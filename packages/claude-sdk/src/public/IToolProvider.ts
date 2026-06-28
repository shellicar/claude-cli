import type { AnyToolDefinition } from './types';

/**
 * The tool-set contract `ToolRegistry` resolves so it need not know about the
 * consumer's concrete tool service. The consumer's tool service implements it.
 */
export abstract class IToolProvider {
  public abstract get tools(): AnyToolDefinition[];
}
