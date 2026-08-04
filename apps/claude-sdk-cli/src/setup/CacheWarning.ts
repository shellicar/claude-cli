import { calculateCostSplit, IDurableConfigProvider } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import type { AuditDerivation } from '../AuditStats.js';
import { type CacheParameters, ModelSettings } from '../model/ModelSettings.js';
import { type CacheParameterChange, StatusState } from '../model/StatusState.js';

/** The parameters a request would go out under right now. */
export const liveCacheParameters = (config: IDurableConfigProvider): CacheParameters => ({
  model: config.getEffectiveModel(),
  thinking: config.getEffectiveThinkingEnabled(),
  effort: config.getEffectiveEffort() ?? null,
});

/** The cache warning's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class ICacheWarning {
  /** Recompute what the next request would cost in cache terms and land it in the status bar.
   *  Call wherever either side can move: an operator toggle, a config reload, a conversation
   *  move, or the send that resolves the divergence. */
  public abstract refresh(): void;

  /** What a conversation being adopted should have its divergence measured against, given what its
   *  audit yielded. */
  public abstract baselineFor(audit: AuditDerivation): CacheParameters | null;
}

/** Each parameter the cache keys on, and how it reads to an operator. */
const PARAMETERS: readonly { name: string; of: (p: CacheParameters) => string }[] = [
  { name: 'model', of: (p) => p.model },
  { name: 'thinking', of: (p) => (p.thinking ? 'on' : 'off') },
  { name: 'effort', of: (p) => p.effort ?? 'default' },
];

/**
 * Warns before an invalidation is paid for rather than after.
 *
 * Changing the model, thinking or effort mid-conversation re-writes the entire cached prefix on the
 * next request, and on a long conversation that is dollars, not cents. The change itself is free:
 * nothing is spent until a request goes out, so between the keypress and the send there is a window
 * where the operator can still cycle back and pay nothing. This is what fills that window.
 *
 * Deliberately not held by `ModelOverrides`, which would need the effective values it is itself an
 * input to. `DurableConfigFactory` depends on the overrides, so the overrides cannot depend back on
 * it; the comparison lives here, above both.
 */
export class CacheWarning extends ICacheWarning {
  @dependsOn(IDurableConfigProvider) private readonly configFactory!: IDurableConfigProvider;
  @dependsOn(ModelSettings) private readonly settings!: ModelSettings;
  @dependsOn(StatusState) private readonly statusState!: StatusState;

  /**
   * A conversation whose audit records the parameters gives them outright. One that has sent nothing
   * has no cached prefix, so there is nothing to measure. The case in between is every conversation
   * that predates the parameters being recorded: it has a prefix, written under settings nobody
   * wrote down. Assuming it was written under the current ones is what lets the warning work on a
   * conversation that started before this existed, rather than staying silent until its next turn.
   *
   * The model is not assumed. The API reports it on every audit line however old, so that much is
   * known and only thinking and effort are guesses. A wrong guess can miss a warning, or raise one
   * for a cost already paid, but only on a conversation that predates the recording and only until
   * its next turn writes down the truth.
   */
  public baselineFor(audit: AuditDerivation): CacheParameters | null {
    if (audit.cached != null) {
      return audit.cached;
    }
    if (audit.lastModel == null) {
      return null;
    }
    return { ...liveCacheParameters(this.configFactory), model: audit.lastModel };
  }

  public refresh(): void {
    const cached = this.settings.cached;
    if (cached == null) {
      this.statusState.setCacheDivergence(null);
      return;
    }
    const live = liveCacheParameters(this.configFactory);
    const changes = PARAMETERS.flatMap(({ name, of }): CacheParameterChange[] => {
      const from = of(cached);
      const to = of(live);
      return from === to ? [] : [{ name, from, to }];
    });
    if (changes.length === 0) {
      this.statusState.setCacheDivergence(null);
      return;
    }
    // The prefix that would be re-written is the whole of the last request's context, which is what
    // the status bar already tracks. Priced at the model the next request would use, and at the
    // one-hour write rate, because that is the TTL every breakpoint is written with.
    const tokens = this.statusState.lastContextUsed;
    const costUsd = calculateCostSplit({ inputTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: tokens, cacheReadTokens: 0, outputTokens: 0 }, live.model);
    this.statusState.setCacheDivergence({ changes, tokens, costUsd });
  }
}
