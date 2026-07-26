import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { pathSchema } from '@shellicar/claude-sdk';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { deleteBatch } from '../../deleteBatch.js';
import { isNodeError } from '../../isNodeError.js';
import { defineToolV2 } from '../defineToolV2.js';

export const DeleteToolV2Model = z.object({
  // Optional at the schema level, not required: an Xargs-fed call legitimately omits this in
  // the wire call (Xargs injects it during execute(), after the wire input is already parsed) --
  // a required field here would reject that call before Xargs ever got a chance to fill it in.
  files: z.array(pathSchema).optional().describe('Paths to delete — files or directories. Feed from Find via Xargs, not a direct pipe.'),
});

/** The V2 tool equivalent of V1's `DeleteFile` and `DeleteDirectory`, unified into one \u2014 same
 *  principle as `Match` losing its `input.kind` branch: in the plain-text, piped world there's
 *  no reliable place to pre-sort "these are files, these are directories" (`Find` yields both
 *  uniformly), so the tool itself checks each target and deletes it the right way, rather than
 *  the caller having to split a batch across two tools first. Reuses `deleteBatch` verbatim,
 *  same as V1 did \u2014 only the per-path operation and error mapping change. `fs.delete` tier,
 *  covering both cases; V1 never split fs.delete by target type either.
 *
 *  Takes `files` as its own marked field only, never an implicit upstream-as-paths read \u2014
 *  same reasoning as `Read`: real Unix has no `find | rm`, only `find | xargs rm`. Taking paths
 *  only through a real field is also what lets `collectPaths` see them for Policy; a value
 *  smuggled through `upstream` was invisible to any path-scoped policy rule. */
export function createDeleteToolV2(fs: IFileSystem) {
  return defineToolV2({
    name: 'Delete',
    description: 'Delete files or directories by path. A directory must be empty.',
    operation: 'fs.delete',
    model: DeleteToolV2Model,
    run: (input, _upstream, stderr): ToolV2Result<string> => {
      let ok = true;

      async function* run(): Stream<string> {
        const result = await deleteBatch(
          input.files ?? [],
          async (path) => {
            const stat = await fs.stat(path);
            if (stat.isDirectory()) {
              await fs.deleteDirectory(path);
            } else {
              await fs.deleteFile(path);
            }
          },
          (err) => {
            if (isNodeError(err, 'ENOENT')) {
              return 'Path not found';
            }
            if (isNodeError(err, 'ENOTEMPTY')) {
              return 'Directory is not empty. Delete the files inside first.';
            }
            return undefined;
          },
        );
        for (const path of result.deleted) {
          yield `deleted: ${path}`;
        }
        for (const e of result.errors) {
          ok = false;
          stderr.push(`${e.path}: ${e.error}`);
        }
      }

      return { stdout: run(), success: () => ok };
    },
  });
}
