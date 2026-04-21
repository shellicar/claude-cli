import { type ConfigWatchHandle, IConfigWatcher } from '../src/Config/interfaces';

/**
 * Test fake for `IConfigWatcher`. Records the paths registered with
 * `watch()` and exposes `trigger(path)` so tests can fire a change event
 * deterministically without touching the real filesystem.
 *
 * Supports only a single active watch registration at a time, which
 * matches how `ConfigLoader` uses it (one `watch()` call per `start()`).
 * A second `watch()` call replaces the first.
 */
export class MemoryConfigWatcher extends IConfigWatcher {
  #paths: readonly string[] = [];
  #onChange: ((path: string) => void) | undefined;

  public watch(paths: readonly string[], onChange: (path: string) => void): ConfigWatchHandle {
    this.#paths = paths;
    this.#onChange = onChange;
    return {
      dispose: (): void => {
        this.#onChange = undefined;
        this.#paths = [];
      },
    };
  }

  public trigger(path: string): void {
    this.#onChange?.(path);
  }

  public get watchedPaths(): readonly string[] {
    return this.#paths;
  }

  public get isActive(): boolean {
    return this.#onChange !== undefined;
  }
}
