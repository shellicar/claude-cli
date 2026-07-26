import { IConfigFileReader } from '@shellicar/claude-core/Config/interfaces';
import { IConfigOptions } from '@shellicar/claude-core/Config/IConfigOptions';
import { mergeRawConfigs } from '@shellicar/claude-core/config';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { PolicyStore } from '@shellicar/claude-sdk-tools/Policy';
import { dependsOn } from '@shellicar/core-di';

export type PolicyConfigNotice = { kind: 'invalid'; error: string } | { kind: 'recovered' } | { kind: 'changed' };

/** The refresh/notice surface for `policy`, kept separate from reading `PolicyStore.current`
 *  directly (which `IOrchestrateEngine` already does, live, needing no interface of its own) \u2014
 *  same ISP shape as `IRulesConfigNotifier`: a consumer that only wants to react to a policy
 *  reload doesn't need to depend on the concrete provider. */
export abstract class IPolicyNotifier {
  public abstract refresh(): void;
  public abstract onNotice(listener: (notice: PolicyConfigNotice) => void): () => void;
}

/** Reads only `policy` off the same files sdkConfigSchema reads, independently of it \u2014 same
 *  "a bad file contributes nothing" handling as `readToolsRaw`, so a JSON syntax error elsewhere
 *  never blocks this section's own read. */
export function readPolicyRaw(paths: readonly string[], reader: IConfigFileReader): unknown {
  const raws: Record<string, unknown>[] = [];
  for (const path of paths) {
    if (!reader.exists(path)) {
      continue;
    }
    try {
      raws.push(JSON.parse(reader.read(path)) as Record<string, unknown>);
    } catch {
      // Skip: the same "contributes nothing" handling readConfig.ts gives a bad JSON file.
    }
  }
  const merged = raws.reduce<Record<string, unknown>>((acc, cur) => mergeRawConfigs(acc, cur), {});
  return merged.policy;
}

/** Wraps `PolicyStore` with the watch/notice surface `RulesConfigGate` gets from
 *  `ConfigRulesConfigProvider` \u2014 but deliberately does NOT fail fast at construction the way
 *  that class does. `PolicyStore` already made that call for `policy` specifically (see its own
 *  header): an invalid initial policy falls back to the safe ask-everything default rather than
 *  refusing to start, because "no policy loaded yet" must still behave as "ask for everything,"
 *  never "the CLI won't start." This class only adds change-tracking on top of that, it doesn't
 *  relitigate it.
 *
 *  Never starts its own watch \u2014 `refresh()` is called by the watch `WorkingDirectoryMoveHandler`
 *  owns and re-points on every `/cd`, the same shape `IRulesConfigNotifier` uses. */
export class ConfigPolicyProvider implements IPolicyNotifier {
  @dependsOn(PolicyStore) private readonly store!: PolicyStore;
  @dependsOn(IConfigOptions) private readonly options!: IConfigOptions;
  @dependsOn(IConfigFileReader) private readonly reader!: IConfigFileReader;
  @dependsOn(ILogger) private readonly logger!: ILogger;

  readonly #listeners = new Set<(notice: PolicyConfigNotice) => void>();
  #degraded = false;
  #lastError: string | null = null;
  // Seeded lazily from the constructed PolicyStore's own state on the first refresh() \u2014 not
  // eagerly here, since @dependsOn properties aren't populated until after construction runs.
  #lastSerialized: string | undefined;

  public onNotice(listener: (notice: PolicyConfigNotice) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  public refresh(): void {
    const notice = this.#update(readPolicyRaw(this.options.paths, this.reader));
    if (notice === null) {
      return;
    }
    if (notice.kind === 'invalid') {
      this.logger.warn('policy failed validation, keeping the previous policy', { error: notice.error });
    } else if (notice.kind === 'recovered') {
      this.logger.info('policy recovered after a previous invalid edit');
    } else {
      this.logger.info('policy updated');
    }
    for (const listener of this.#listeners) {
      listener(notice);
    }
  }

  #update(raw: unknown): PolicyConfigNotice | null {
    if (this.#lastSerialized === undefined) {
      this.#lastSerialized = JSON.stringify(this.store.current);
    }

    const result = this.store.update(raw);
    if (!result.accepted) {
      const error = result.errors.join('\n');
      const isRepeat = this.#degraded && this.#lastError === error;
      this.#degraded = true;
      this.#lastError = error;
      return isRepeat ? null : { kind: 'invalid', error };
    }

    const wasDegraded = this.#degraded;
    this.#degraded = false;
    this.#lastError = null;

    const serialized = JSON.stringify(this.store.current);
    if (serialized === this.#lastSerialized) {
      return wasDegraded ? { kind: 'recovered' } : null;
    }
    this.#lastSerialized = serialized;
    return wasDegraded ? { kind: 'recovered' } : { kind: 'changed' };
  }
}
