import type { Clock } from '@js-joda/core';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { OrchestrateApprovalContext, OrchestrateBatchItem, SdkMessage, ToolAttachmentBlock, ToolOutcome } from '@shellicar/claude-sdk';
import { type ApprovalCoordinator, IOrchestrateEngine, type ISdkMessagePublisher } from '@shellicar/claude-sdk';
import type { IScopedProvider, IServiceProvider } from '@shellicar/core-di';
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
 *  Takes `logger`/`provider`/`approval`/`publisher` as explicit constructor arguments, not
 *  `@dependsOn` — this class is built by a manual factory in container.ts (and constructed
 *  directly with `new` in tests), never resolved purely through the DI container, so a
 *  `@dependsOn` field would never be populated in either of those call sites.
 *
 *  Owns every V2 approval concern outright: `runBatch` decides whether a gated stage needs
 *  asking, mints/keys its own requestId per tool_use, and sends the `tool_approval_request`
 *  wire message itself, using the same `ApprovalCoordinator`/publisher QueryRunner's V1 phase
 *  uses. QueryRunner supplies nothing but the raw batch and a `requireApproval` flag — no
 *  coordination of any kind lives on QueryRunner for V2. */
export class OrchestrateEngine extends IOrchestrateEngine {
  readonly #registry: ToolsV2Registry;
  readonly #policyStore: PolicyStore;
  readonly #logger: ILogger;
  readonly #provider: IServiceProvider;
  readonly #approval: ApprovalCoordinator;
  readonly #publisher: ISdkMessagePublisher;
  readonly #fs: IFileSystem;
  readonly #clock: Clock;

  public constructor(registry: ToolsV2Registry, policyStore: PolicyStore, logger: ILogger, provider: IServiceProvider, approval: ApprovalCoordinator, publisher: ISdkMessagePublisher, fs: IFileSystem, clock: Clock) {
    super();
    this.#registry = registry;
    this.#policyStore = policyStore;
    this.#logger = logger;
    this.#provider = provider;
    this.#approval = approval;
    this.#publisher = publisher;
    this.#fs = fs;
    this.#clock = clock;
  }

  public owns(name: string): boolean {
    return name === 'Orchestrate' || this.#registry.get(name) != null;
  }

  /** Opens exactly one DI scope for the whole batch, runs every item against it, and lets it go
   *  out of scope (disposing whatever it resolved) only once every item has settled — so a
   *  batch of several V2 tool_uses in the same round shares one instance of a per-batch-scoped
   *  resource instead of each call opening (and tearing down) its own.
   *
   *  All approval coordination for the batch lives here: a per-item stage-index counter mints
   *  each gated stage's own `${toolUseId}:${stageIndex}` requestId, `#approval.cancelled` is
   *  checked before ever asking, and the `tool_approval_request` wire message is sent directly
   *  through `#publisher` — the same mechanism V1 already uses, reused here rather than handed
   *  back to the caller to reconstruct. */
  public async runBatch(items: OrchestrateBatchItem[], requireApproval: boolean, signal?: AbortSignal): Promise<Map<string, ToolOutcome>> {
    await using scope = this.#provider.createScope();
    const entries = await Promise.all(
      items.map(async (item): Promise<[string, ToolOutcome]> => {
        const requestApproval = requireApproval
          ? async (ctx: OrchestrateApprovalContext): Promise<boolean> => {
              if (this.#approval.cancelled) {
                return false;
              }
              // The stage's real position in the pipeline, straight from `execute()`'s own loop
              // — never a count of how many stages have asked so far. A stage that asks is
              // reported where it actually sits, so "3 of 3" means the last step of three, even
              // when the first two were auto-allowed and never asked at all.
              const requestId = `${item.id}:${ctx.stagePosition - 1}`;
              // Drained here because a person is about to be shown it, which is the only reason
              // anything drains: a verdict Policy reached on its own never touches the stream.
              const piped = await ctx.batch();
              const response = await this.#approval.request(requestId, () => {
                // The stage as the caller wrote it, variables unresolved. This request is published
                // whether or not it is granted, so a value resolved into it would be exposed by the
                // asking rather than by the answer. The decision itself is made on `ctx.input`,
                // which is fully resolved. `ctx.batch` (whatever was piped in) is secondary
                // context, only worth showing when non-empty: a bare `piped: []` for an ordinary
                // producer stage would just be noise.
                const approvalInput = { ...(ctx.asWritten as Record<string, unknown>), ...(piped.length > 0 ? { piped } : {}) };
                this.#publisher.send({ type: 'tool_approval_request', requestId, toolUseId: item.id, name: ctx.name, input: approvalInput, v2: true, stageIndex: ctx.stagePosition, stageCount: ctx.stageCount } satisfies SdkMessage);
              });
              return response.approved;
            }
          : undefined;
        const outcome = await this.#runOne(item.name, item.input, requestApproval, signal, scope);
        return [item.id, outcome];
      }),
    );
    return new Map(entries);
  }

  async #runOne(name: string, input: unknown, requestApproval: ((ctx: OrchestrateApprovalContext) => Promise<boolean>) | undefined, signal: AbortSignal | undefined, scope: IScopedProvider | undefined): Promise<ToolOutcome> {
    // The same cwd the tools themselves resolve relative paths against (Program.cwd defaults to
    // it), so a $PWD-scoped rule judges the directory the call actually runs in.
    const approve = createPolicyGatedApproval(this.#policyStore, this.#registry, this.#fs, this.#logger, requestApproval);
    const startedAt = this.#clock.millis();
    try {
      const result = await runToolV2Call(name, input, this.#registry, approve, signal, scope);
      // A cancel that arrived mid-run is reported by the caller's own signal, not by anything
      // execute() itself distinguishes internally — orchestrate only stops advancing to further
      // stages once aborted (see execute.ts), it never labels a stage's own outcome as "cancelled".
      // This is the one place that reads the signal back to decide the *call's* outcome.
      if (signal?.aborted) {
        return { kind: 'cancelled', elapsedMs: this.#clock.millis() - startedAt };
      }
      return result.ok ? { kind: 'ok', content: result.content, ...(result.attachments.length > 0 ? { blocks: result.attachments as ToolAttachmentBlock[] } : {}) } : { kind: 'failed', error: result.error };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { kind: 'failed', error };
    }
  }
}
