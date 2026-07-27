import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { ToolAttachmentBlock, ToolOutcome } from '@shellicar/claude-sdk';
import { IOrchestrateEngine } from '@shellicar/claude-sdk';
import type { PolicyStore } from '../Policy/PolicyStore.js';
import { createPolicyGatedApproval } from './policyGatedApproval.js';
import type { ToolsV2Registry } from './registry.js';
import { runToolV2Call } from './runToolV2Call.js';

/** The concrete `IOrchestrateEngine` `QueryRunner` dispatches to. Owns exactly the names the
 *  registry knows about, plus `Orchestrate` itself — everything else falls through to V1
 *  untouched. Maps `runToolV2Call`'s `{ ok, content } | { ok, error }` onto the shared
 *  `ToolOutcome` taxonomy so `QueryRunner` doesn't need a second result shape for V2.
 *
 *  Approval is genuinely decided here, not by QueryRunner: every gated stage is checked against
 *  `policyStore.current` first (see `createPolicyGatedApproval`) — `allow`/`deny` never reach
 *  a human at all, and the human-ask callback QueryRunner supplies is only invoked for whatever
 *  Policy itself leaves as `ask`.
 *
 *  Takes `logger` as an explicit constructor argument, not `@dependsOn` — this class is built
 *  by a manual factory in container.ts (and constructed directly with `new` in tests), never
 *  resolved purely through the DI container, so a `@dependsOn` field would never be populated
 *  in either of those call sites. */
export class OrchestrateEngine extends IOrchestrateEngine {
  readonly #registry: ToolsV2Registry;
  readonly #policyStore: PolicyStore;
  readonly #logger: ILogger;

  public constructor(registry: ToolsV2Registry, policyStore: PolicyStore, logger: ILogger) {
    super();
    this.#registry = registry;
    this.#policyStore = policyStore;
    this.#logger = logger;
  }

  public owns(name: string): boolean {
    return name === 'Orchestrate' || this.#registry.get(name) != null;
  }

  public async run(name: string, input: unknown, requestApproval?: (ctx: { name: string; operation: string; input: unknown; batch: unknown[] }) => Promise<boolean>, signal?: AbortSignal): Promise<ToolOutcome> {
    const approve = createPolicyGatedApproval(this.#policyStore, this.#registry, () => process.cwd(), this.#logger, requestApproval);
    const startedAt = Date.now();
    const result = await runToolV2Call(name, input, this.#registry, approve, signal);
    // A cancel that arrived mid-run is reported by the caller's own signal, not by anything
    // execute() itself distinguishes internally — orchestrate only stops advancing to further
    // stages once aborted (see execute.ts), it never labels a stage's own outcome as "cancelled".
    // This is the one place that reads the signal back to decide the *call's* outcome.
    if (signal?.aborted) {
      return { kind: 'cancelled', elapsedMs: Date.now() - startedAt };
    }
    return result.ok ? { kind: 'ok', content: result.content, ...(result.attachments.length > 0 ? { blocks: result.attachments as ToolAttachmentBlock[] } : {}) } : { kind: 'failed', error: result.error };
  }
}
