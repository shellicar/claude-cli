import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { Leaf, LeafResult } from '@shellicar/orchestrate-core';
import { walkLazy } from '../walkLazy.js';

export type FindLeafInput = {
  path: string;
  pattern?: string;
  type?: 'file' | 'directory' | 'both';
  exclude?: string[];
  maxDepth?: number;
  followSymlinks?: boolean;
};

/** The Orchestrate leaf equivalent of the V1 `Find` tool — same options, same matching rules
 *  (pattern tests the entry name, matching the actual V1 behaviour, not its description),
 *  but genuinely lazy: `walkLazy` yields as it discovers, so a downstream `Head` can stop the
 *  walk early instead of forcing it to complete first (see the design doc's streaming
 *  requirement). `fs.list` tier — this reads directory entries, not file content. */
export function createFindLeaf(fs: IFileSystem): Leaf<FindLeafInput, string> {
  return {
    name: 'Find',
    operation: 'fs.list',
    run: (input, _upstream, stderr): LeafResult<string> => {
      let ok = true;
      const re = input.pattern ? new RegExp(input.pattern) : undefined;
      return {
        stdout: (async function* () {
          try {
            for await (const record of walkLazy(fs, input.path, { pattern: input.pattern, type: input.type, exclude: input.exclude, maxDepth: input.maxDepth, followSymlinks: input.followSymlinks }, 1, re)) {
              yield record.path;
            }
          } catch (err) {
            ok = false;
            stderr.push(err instanceof Error ? err.message : String(err));
          }
        })(),
        success: () => ok,
      };
    },
  };
}
