import type { z } from 'zod';
import { mergeRawConfigs } from '../config';
import { IConfigLoader } from './interfaces';
import type { ConfigChangeListener, ConfigLoaderOptions, ConfigSource, ConfigUnsubscribe, ConfigWatchHandle, ReadResult } from './types';

/**
 * Concrete config loader. Owns the full lifecycle: load, watch, diff, emit.
 *
 * All I/O flows through `IConfigFileReader` and `IConfigWatcher` so the class
 * is fully testable with in-memory fakes.
 *
 * Load-time vs reload-time semantics differ:
 * - At `load()`, a file that fails JSON parsing contributes nothing, a
 *   warning is recorded, and the load succeeds against whatever remained.
 *   This keeps the first-run experience forgiving.
 * - On reload, any parse error aborts the reload and keeps the previous
 *   config + sources intact. A transient broken edit must not clear origin
 *   tracking or drop the user back to schema defaults.
 */
export class ConfigLoader<T extends z.ZodType> extends IConfigLoader<T> {
  readonly #options: ConfigLoaderOptions<T>;
  #sources: ConfigSource[] = [];
  #warnings: string[] = [];
  #config: z.infer<T> | undefined;
  readonly #listeners = new Set<ConfigChangeListener<z.infer<T>>>();
  #watchHandle: ConfigWatchHandle | undefined;
  #debounce: ReturnType<typeof setTimeout> | undefined;

  public constructor(options: ConfigLoaderOptions<T>) {
    super();
    this.#options = options;
  }

  public load(): void {
    const result = this.#readAll();
    this.#sources = result.sources;
    this.#warnings = result.warnings;
    this.#config = this.#options.schema.parse(result.merged) as z.infer<T>;
  }

  public start(): void {
    const { watcher, paths } = this.#options;
    if (watcher === undefined) {
      return;
    }
    this.#watchHandle = watcher.watch(paths, () => this.#scheduleReload());
  }

  public dispose(): void {
    this.#watchHandle?.dispose();
    this.#watchHandle = undefined;
    if (this.#debounce !== undefined) {
      clearTimeout(this.#debounce);
      this.#debounce = undefined;
    }
  }

  public get config(): z.infer<T> {
    if (this.#config === undefined) {
      throw new Error('ConfigLoader.load() has not been called');
    }
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

  #scheduleReload(): void {
    const debounceMs = this.#options.debounceMs ?? 100;
    if (debounceMs === 0) {
      this.#reload();
      return;
    }
    if (this.#debounce !== undefined) {
      clearTimeout(this.#debounce);
    }
    this.#debounce = setTimeout(() => {
      this.#debounce = undefined;
      this.#reload();
    }, debounceMs);
  }

  #reload(): void {
    const previousConfig = this.#config;
    const result = this.#readAll();

    // Parse errors during reload are treated as transient: keep previous
    // state rather than advancing with partial data.
    if (result.warnings.length > 0) {
      this.#options.logger?.warn('config reload encountered parse errors, keeping previous config', { warnings: result.warnings });
      return;
    }

    let parsed: z.infer<T>;
    try {
      parsed = this.#options.schema.parse(result.merged) as z.infer<T>;
    } catch (err) {
      this.#options.logger?.warn('config reload failed schema validation, keeping previous config', { error: String(err) });
      return;
    }

    if (previousConfig !== undefined && JSON.stringify(previousConfig) === JSON.stringify(parsed)) {
      return;
    }

    this.#sources = result.sources;
    this.#warnings = result.warnings;
    this.#config = parsed;

    for (const listener of this.#listeners) {
      listener(parsed);
    }
  }

  #readAll(): ReadResult {
    const { paths, reader, mergeOptions } = this.#options;
    const sources: ConfigSource[] = [];
    const warnings: string[] = [];
    const raws: Record<string, unknown>[] = [];

    for (const path of paths) {
      if (!reader.exists(path)) {
        continue;
      }
      const text = reader.read(path);
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        sources.push({ path, raw: parsed });
        raws.push(parsed);
      } catch {
        warnings.push(`Failed to parse ${path}`);
      }
    }

    const merged = raws.reduce<Record<string, unknown>>((acc, cur) => mergeRawConfigs(acc, cur, mergeOptions), {});

    return { sources, warnings, merged };
  }
}
