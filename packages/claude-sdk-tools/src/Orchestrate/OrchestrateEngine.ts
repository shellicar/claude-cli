import { IOrchestrateEngine } from '@shellicar/claude-sdk';
import type { ToolOutcome } from '@shellicar/claude-sdk';
import type { ToolsV2Registry } from './registry.js';
import { runToolV2Call } from './runToolV2Call.js';

/** The concrete `IOrchestrateEngine` `QueryRunner` dispatches to. Owns exactly the names the
 *  registry knows about, plus `Orchestrate` itself \u2014 everything else falls through to V1
 *  untouched. Maps `runToolV2Call`'s `{ ok, content } | { ok, error }` onto the shared
 *  `ToolOutcome` taxonomy so `QueryRunner` doesn't need a second result shape for V2. */
export class OrchestrateEngine extends IOrchestrateEngine {
  readonly #registry: ToolsV2Registry;

  public constructor(registry: ToolsV2Registry) {
    super();
    this.#registry = registry;
  }

  public owns(name: string): boolean {
    return name === 'Orchestrate' || this.#registry.get(name) != null;
  }

  public async run(name: string, input: unknown, requestApproval?: (stageName: string, resolvedBatch: unknown[]) => Promise<boolean>): Promise<ToolOutcome> {
    const result = await runToolV2Call(name, input, this.#registry, requestApproval);
    return result.ok ? { kind: 'ok', content: result.content } : { kind: 'failed', error: result.error };
  }
}
