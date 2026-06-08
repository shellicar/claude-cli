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
  public watch(_paths: readonly string[], _onChange: (path: string) => void): ConfigWatchHandle {
    throw new Error('not implemented');
  }
}
