import type { z } from 'zod';
import type { MergeOptions } from '../config';
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
