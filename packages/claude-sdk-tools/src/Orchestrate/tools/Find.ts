import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { ToolV2Result } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { regexPattern } from '../../regexPattern.js';
import { defineToolV2 } from '../defineToolV2.js';
import { walkLazy } from '../walkLazy.js';

export const FindToolV2Model = z.object({
  path: z.string().describe('Directory to search. Supports absolute, relative, ~ and $HOME.'),
  pattern: regexPattern('Match against file paths', ['\\.ts$', '\\.(ts|js)$']).optional(),
  type: z.enum(['file', 'directory', 'both']).optional(),
  exclude: z.array(z.string()).optional(),
  maxDepth: z.number().int().min(1).optional(),
  followSymlinks: z.boolean().optional(),
});

/** The V2 tool equivalent of V1's `Find` — same options, same matching rules (pattern tests
 *  the entry name), but genuinely lazy: `walkLazy` yields as it discovers, so a downstream
 *  `Head` can stop the walk early instead of forcing it to complete first (see the design
 *  doc's streaming requirement). `fs.list` tier — this reads directory entries, not file
 *  content. */
export function createFindToolV2(fs: IFileSystem) {
  return defineToolV2({
    name: 'Find',
    description: 'Find files or directories under a directory. Source: starts an Orchestrate pipe.',
    operation: 'fs.list',
    model: FindToolV2Model,
    run: (input, _upstream, stderr): ToolV2Result<string> => {
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
  });
}
