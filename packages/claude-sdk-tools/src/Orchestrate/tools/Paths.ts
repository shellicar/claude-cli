import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { pathSchema } from '@shellicar/claude-sdk';
import type { ToolV2Result } from '@shellicar/orchestrate-core';
import { fromLines } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { defineToolV2 } from '../defineToolV2.js';

export const PathsToolV2Model = z.object({
  paths: z.array(pathSchema).min(1).describe('Explicit file or directory paths to start an Orchestrate sequence from.'),
});

/** The V2 tool equivalent of V1's `Paths` \u2014 the other Pipe source alongside `Find`: use when
 *  the caller already knows the paths, rather than discovering them. `fs.list` tier, same as
 *  `Find`: this only confirms each path exists (stat), it doesn't read file content. Fails the
 *  whole call on the first missing path \u2014 same fatal-on-first-miss behaviour V1 has, since a
 *  caller who names an explicit path expects it to exist. */
export function createPathsToolV2(fs: IFileSystem) {
  return defineToolV2({
    name: 'Paths',
    description: 'Start an Orchestrate sequence from explicit, already-known paths. Source: use when you name the files, rather than discovering them with Find.',
    operation: 'fs.list',
    model: PathsToolV2Model,
    run: (input, _upstream, stderr): ToolV2Result => {
      let ok = true;
      return {
        stdout: fromLines(
          (async function* () {
            for (const path of input.paths) {
              try {
                await fs.stat(path);
              } catch {
                ok = false;
                stderr.push(`Path not found: ${path}`);
                return;
              }
              yield path;
            }
          })(),
        ),
        success: () => ok,
      };
    },
  });
}
