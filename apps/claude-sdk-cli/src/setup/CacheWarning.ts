import { buildRequestParams, calculateCostSplit, IConversation, IDurableConfigProvider, ITokenCounter } from '@shellicar/claude-sdk';
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

  /** Start counting the conversation under a model the operator is looking at but has not chosen.
   *  Called while the model editor holds a name the catalogue recognises, so the size is usually
   *  known by the time the choice is made and the warning has a figure the instant it appears. */
  public abstract prefetch(model: string): void;
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
  @dependsOn(ITokenCounter) private readonly counter!: ITokenCounter;
  @dependsOn(IConversation) private readonly conversation!: IConversation;
  // Bumped by every refresh, so a count that lands after the operator has moved on is recognised as
  // an answer to a question nobody is asking any more and dropped.
  #generation = 0;
  // A count taken ahead of the choice, spent the moment that model is chosen. Holding it for longer
  // would mean holding a figure for a conversation that has since grown.
  #prefetched: { model: string; tokens: number } | null = null;
  #counting: string | null = null;

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
    const generation = ++this.#generation;
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
    // A token count belongs to the model that produced it, so the last turn's count is already the
    // right number unless the model itself is what moved.
    if (cached.model === live.model) {
      this.#publish(changes, this.statusState.lastContextUsed, live.model);
      return;
    }
    // The models may not tokenise alike: the same prefix came back as 12,223 tokens on sonnet-4-6
    // and 15,948 on sonnet-5. So the old count is not shown while the new model's is unknown; a
    // count taken ahead of the choice usually means it never is.
    const prefetched = this.#prefetched?.model === live.model ? this.#prefetched.tokens : null;
    this.#prefetched = null;
    this.#publish(changes, prefetched, live.model);
    if (prefetched == null) {
      void this.#countUnderLiveModel(generation, changes, live.model);
    }
  }

  public prefetch(model: string): void {
    if (model === this.#prefetched?.model || model === this.#counting) {
      return;
    }
    this.#counting = model;
    void this.#countFor(model).then((tokens) => {
      this.#counting = null;
      if (tokens != null) {
        this.#prefetched = { model, tokens };
      }
    });
  }

  #publish(changes: readonly CacheParameterChange[], tokens: number | null, model: string): void {
    // The whole of the last request's context is what gets re-written, priced at the model the next
    // request would use and at the one-hour write rate, the TTL every breakpoint is written with.
    const costUsd = tokens == null ? null : calculateCostSplit({ inputTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: tokens, cacheReadTokens: 0, outputTokens: 0 }, model);
    this.statusState.setCacheDivergence({ changes, tokens, costUsd });
  }

  async #countUnderLiveModel(generation: number, changes: readonly CacheParameterChange[], model: string): Promise<void> {
    const counted = await this.#countFor(model);
    if (counted == null || generation !== this.#generation) {
      return;
    }
    this.#publish(changes, counted, model);
  }

  /**
   * Counts the conversation as a request under one model, which may not be the one the config
   * currently names: a prefetch runs for a model the operator is only looking at.
   *
   * `durable` is the same object TurnRunner reads its builder options from, so this is the request
   * the send would actually make. `cloneForRequest` carries the CLAUDE.md and skill reminders,
   * which are persisted into the first user message; the per-turn ephemeral ones are absent, and
   * are a few dozen tokens against a prefix measured in tens of thousands.
   */
  async #countFor(model: string): Promise<number | null> {
    const durable = this.configFactory.config;
    const messages = this.conversation.cloneForRequest(durable.compact?.enabled ?? false);
    return this.counter.count(buildRequestParams({ ...durable, model }, messages));
  }
}
