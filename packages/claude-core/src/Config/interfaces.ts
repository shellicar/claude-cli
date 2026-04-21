import type { z } from 'zod';
import type { ConfigChangeListener, ConfigSource, ConfigUnsubscribe, ConfigWatchHandle } from './types';

export type { ConfigWatchHandle } from './types';

/**
 * Abstract interface for reading config files off the filesystem.
 *
 * Kept synchronous because config loading happens once at startup and the
 * surface should be trivial to implement against any storage backend (disk,
 * memory, mock). The real-world implementation wraps `node:fs` sync APIs.
 */
export abstract class IConfigFileReader {
  public abstract exists(path: string): boolean;
  public abstract read(path: string): string;
}

/**
 * Abstract interface for a config loader bound to a Zod schema `T`.
 *
 * Two-layer model:
 * - `sources`: ordered array of `ConfigSource` entries (layer 1, raw)
 * - `config`: the merged+validated `z.infer<T>` (layer 2, resolved)
 *
 * Lifecycle:
 * - `load()` performs the initial synchronous load
 * - `start()` begins watching (no-op if no watcher was supplied)
 * - `dispose()` stops watching and releases resources
 * - `onChange()` registers a listener; returns an unsubscribe function
 */
export abstract class IConfigLoader<T extends z.ZodType> {
  public abstract load(): void;
  public abstract start(): void;
  public abstract dispose(): void;
  public abstract get config(): z.infer<T>;
  public abstract get sources(): readonly ConfigSource[];
  public abstract get warnings(): readonly string[];
  public abstract onChange(listener: ConfigChangeListener<z.infer<T>>): ConfigUnsubscribe;
}

/**
 * Abstract interface for watching config files for changes.
 *
 * Implementations deliver raw change events; the consuming `ConfigLoader`
 * owns debounce and dedup. The event carries the triggering path so the
 * loader can map back to a source if needed, though the loader reloads
 * every source on any change because cross-file merge semantics make
 * per-path reload incorrect.
 */
export abstract class IConfigWatcher {
  public abstract watch(paths: readonly string[], onChange: (path: string) => void): ConfigWatchHandle;
}
