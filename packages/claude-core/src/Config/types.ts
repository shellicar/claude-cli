import type { z } from 'zod';
import type { MergeOptions } from '../config';
import type { IFileSystem } from '../fs/interfaces';
import type { IConfigFileReader, IConfigWatcher } from './interfaces';

/**
 * Minimal logger surface so claude-core does not depend on any specific
 * logger implementation. Supply any object with a `warn` method.
 */
export interface ConfigLoaderLogger {
  warn(message: string, meta?: unknown): void;
}

export interface ConfigLoaderOptions<T extends z.ZodType> {
  readonly schema: T;
  /**
   * Ordered list of config file paths. Earlier paths have lower precedence;
   * later paths override earlier ones. Merge semantics match
   * `mergeRawConfigs`: null in a later source deletes the key from the
   * earlier source.
   */
  readonly paths: readonly string[];
  readonly reader: IConfigFileReader;
  /** Optional watcher. If omitted, `start()` is a no-op. */
  readonly watcher?: IConfigWatcher;
  readonly mergeOptions?: MergeOptions;
  /**
   * Debounce applied to watcher events before a reload is triggered.
   * Defaults to 100ms to coalesce editor save bursts. Set to 0 to reload
   * on every event (useful in tests).
   */
  readonly debounceMs?: number;
  readonly logger?: ConfigLoaderLogger;
  /**
   * Config fields that contain path strings. Each entry is a sequence of
   * key segments walked into the raw JSON
   * (e.g. `['hooks', 'approvalNotify', 'command']`). For each source file,
   * listed fields are resolved against the source file's directory and
   * passed through `expandPath` (`~`, `$VAR`, `${VAR}`) before the layered
   * merge. Resolution happens at read time, not after merge, so a relative
   * path always resolves against the file it came from. Missing fields and
   * non-string leaves are left untouched.
   */
  readonly pathFields?: readonly (readonly string[])[];
  /**
   * File system abstraction used for `~` and env-var expansion in path
   * fields. Always required: path resolution is a first-class loader
   * feature, not an opt-in, so callers must supply a concrete `fs` even
   * when no `pathFields` are declared.
   */
  readonly fs: IFileSystem;
}

/**
 * A single config source: the file path it came from and its raw parsed
 * content (JSON object, before schema validation).
 *
 * Raw content is preserved because parsed content erases the distinction
 * between "explicitly set" and "defaulted by the schema". Consumers that
 * need to know which file set a given value walk the sources array in
 * reverse (last-writer-wins).
 */
export interface ConfigSource {
  readonly path: string;
  readonly raw: Record<string, unknown>;
}

export type ConfigChangeListener<T> = (config: T) => void;
export type ConfigUnsubscribe = () => void;

/**
 * Handle returned by `IConfigWatcher.watch()`. Call `dispose()` to stop
 * watching the registered paths.
 */
export interface ConfigWatchHandle {
  dispose(): void;
}

export interface ReadResult {
  sources: ConfigSource[];
  warnings: string[];
  merged: Record<string, unknown>;
}
