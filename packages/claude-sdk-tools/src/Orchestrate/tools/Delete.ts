import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { pathSchema } from '@shellicar/claude-sdk';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { deleteBatch } from '../../deleteBatch.js';
import { isNodeError } from '../../isNodeError.js';
import { defineToolV2 } from '../defineToolV2.js';

export const DeleteToolV2Model = z.object({
  files: z.array(pathSchema).optional().describe('Paths to delete \u2014 files or directories. Omit when piped from an upstream stage instead.'),
});

/** The V2 tool equivalent of V1's `DeleteFile` and `DeleteDirectory`, unified into one \u2014 same
 *  principle as `Match` losing its `input.kind` branch: in the plain-text, piped world there's
 *  no reliable place to pre-sort "these are files, these are directories" (`Find` yields both
 *  uniformly), so the tool itself checks each target and deletes it the right way, rather than
 *  the caller having to split a batch across two tools first. Reuses `deleteBatch` verbatim,
 *  same as V1 did \u2014 only the per-path operation and error mapping change. `fs.delete` tier,
 *  covering both cases; V1 never split fs.delete by target type either. */
export function createDeleteToolV2(fs: IFileSystem) {
  return defineToolV2({
    name: 'Delete',
    description: 'Delete files or directories by path. A directory must be empty.',
    operation: 'fs.delete',
    model: DeleteToolV2Model,
    run: (input, upstream, stderr): ToolV2Result<string> => {
      let ok = true;

      async function collectTargets(): Promise<string[]> {
        if (input.files && input.files.length > 0) {
          return input.files;
        }
        if (upstream == null) {
          return [];
        }
        const targets: string[] = [];
        for await (const value of upstream) {
          targets.push(String(value));
        }
        return targets;
      }

      async function* run(): Stream<string> {
        const targets = await collectTargets();
        const result = await deleteBatch(
          targets,
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
