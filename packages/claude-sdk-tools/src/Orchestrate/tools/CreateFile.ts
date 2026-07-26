import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { pathSchema } from '@shellicar/claude-sdk';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { performCreateFile } from '../../CreateFile/performCreateFile.js';
import { defineToolV2 } from '../defineToolV2.js';

export const CreateFileToolV2Model = z.object({
  path: pathSchema.describe('Path to the file to create. Supports absolute, relative, ~ and $HOME.'),
  content: z.string().optional().describe('Initial file content. Defaults to empty.'),
  overwrite: z.boolean().optional().describe('If false (default), error if file already exists. If true, error if file does not exist.'),
});

/** The V2 tool equivalent of V1's `CreateFile` \u2014 same overwrite semantics (default: error if
 *  the file already exists; `overwrite: true` instead requires it already exist). `fs.write`
 *  tier. `path` is its own marked field, same as every write-shaped V2 tool \u2014 a create target
 *  is always named explicitly, never implicit from a pipe. */
export function createCreateFileToolV2(fs: IFileSystem) {
  return defineToolV2({
    name: 'CreateFile',
    description: 'Create a new file with optional content. Creates parent directories automatically. By default errors if the file already exists. Set overwrite: true to replace an existing file (errors if file does not exist).',
    operation: 'fs.write',
    model: CreateFileToolV2Model,
    run: (input, _upstream, stderr): ToolV2Result<string> => {
      let ok = true;

      async function* run(): Stream<string> {
        const result = await performCreateFile(fs, input.path, input.content ?? '', input.overwrite ?? false);
        if (!result.ok) {
          ok = false;
          stderr.push(result.message);
          return;
        }
        yield `created: ${input.path}`;
      }

      return { stdout: run(), success: () => ok };
    },
  });
}
