import { type FSWatcher, watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import { IConfigWatcher } from './interfaces';
import type { ConfigWatchHandle } from './types';

/**
 * `IConfigWatcher` backed by directory watching. For each path we watch its
 * parent directory and filter change events by filename. This fixes two
 * defects of watching the file path directly:
 *  - a file that does not exist when watching starts is still observed once
 *    created (the directory exists even when the file does not);
 *  - an editor that swaps the file's inode (e.g. vim's write-rename) does not
 *    leave a stale watch, because the watch is on the directory, not the inode.
 *
 * Directories are watched once even when several paths share one. If a
 * directory itself does not exist, its files are unwatched until it appears;
 * watching a non-existent directory is out of scope.
 */
export class NodeDirectoryWatcher extends IConfigWatcher {
  public watch(paths: readonly string[], onChange: (path: string) => void): ConfigWatchHandle {
    const basenamesByDir = new Map<string, Map<string, string>>();
    for (const path of paths) {
      const dir = dirname(path);
      const base = basename(path);
      let bases = basenamesByDir.get(dir);
      if (bases === undefined) {
        bases = new Map();
        basenamesByDir.set(dir, bases);
      }
      bases.set(base, path);
    }

    const watchers: FSWatcher[] = [];
    for (const [dir, bases] of basenamesByDir) {
      try {
        const watcher = watch(dir, (_event, filename) => {
          if (filename === null) {
            return;
          }
          const original = bases.get(filename);
          if (original !== undefined) {
            onChange(original);
          }
        });
        watchers.push(watcher);
      } catch {
        // directory does not exist yet; its files are unwatched until it appears
      }
    }

    return {
      [Symbol.dispose](): void {
        for (const watcher of watchers) {
          watcher.close();
        }
      },
    };
  }
}
