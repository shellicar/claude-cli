import type { z } from 'zod';
import { IConfigLoader } from './interfaces';
import type { ConfigChangeListener, ConfigResult, ConfigSource, ConfigUnsubscribe } from './types';

/**
 * Holds the parsed config and notifies listeners. It does no file reading,
 * watching, or two-phase initialisation of its own: the composition root
 * constructs it (via a factory) with an already-parsed `ConfigResult` from
 * `readConfig`, so the held config is never undefined and an initial read
 * failure surfaces eagerly at `buildProvider`.
 *
 * `ConfigReloader` owns the watch-driven reload and calls `apply()` with a
 * fresh result. The two-layer model is preserved:
 * - `sources`: ordered array of `ConfigSource` entries (layer 1, raw)
 * - `config`: the merged+validated `z.infer<T>` (layer 2, resolved)
 */
export class ConfigLoader<T extends z.ZodType> extends IConfigLoader<T> {
  #config: z.infer<T>;
  #sources: readonly ConfigSource[];
  #warnings: readonly string[];
  readonly #listeners = new Set<ConfigChangeListener<z.infer<T>>>();

  public constructor(initial: ConfigResult<z.infer<T>>) {
    super();
    this.#config = initial.config;
    this.#sources = initial.sources;
    this.#warnings = initial.warnings;
  }

  public get config(): z.infer<T> {
    return this.#config;
  }

  public get sources(): readonly ConfigSource[] {
    return this.#sources;
  }

  public get warnings(): readonly string[] {
    return this.#warnings;
  }

  public onChange(listener: ConfigChangeListener<z.infer<T>>): ConfigUnsubscribe {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Swap the held config for a freshly read result and notify listeners.
   * Called by `ConfigReloader` after a watched file changes. A state
   * mutation, not a lifecycle step.
   */
  public apply(next: ConfigResult<z.infer<T>>): void {
    this.#config = next.config;
    this.#sources = next.sources;
    this.#warnings = next.warnings;
    for (const listener of this.#listeners) {
      listener(next.config);
    }
  }
}
