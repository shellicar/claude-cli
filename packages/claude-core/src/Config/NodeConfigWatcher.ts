import { type FSWatcher, watch } from 'node:fs';
import { IConfigWatcher } from './interfaces';
import type { ConfigWatchHandle } from './types';

/**
 * `IConfigWatcher` backed by `node:fs.watch`. Missing files are ignored
 * silently on registration; the config loader already handles transient
 * absence as "empty source".
 */
export class NodeConfigWatcher extends IConfigWatcher {
  public watch(paths: readonly string[], onChange: (path: string) => void): ConfigWatchHandle {
    const watchers: FSWatcher[] = [];
    for (const p of paths) {
      try {
        watchers.push(watch(p, () => onChange(p)));
      } catch {
        // file may not exist yet; that's fine
      }
    }
    return {
      dispose(): void {
        for (const w of watchers) {
          w.close();
        }
      },
    };
  }
}
