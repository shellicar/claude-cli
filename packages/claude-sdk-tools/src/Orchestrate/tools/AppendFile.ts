import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { pathSchema } from '@shellicar/claude-sdk';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { fromLines } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { defineToolV2 } from '../defineToolV2.js';

export const AppendFileToolV2Model = z.object({
  path: pathSchema.describe('Path to the file to append to. Supports absolute, relative, ~ and $HOME.'),
  content: z.string().describe('Text to append to the end of the file. Written verbatim; no separator is inserted at the seam.'),
});

/** The V2 tool equivalent of V1's `AppendFile` \u2014 creates the file (and missing parent
 *  directories) if it doesn't exist, otherwise appends verbatim. `fs.write` tier. */
export function createAppendFileToolV2(fs: IFileSystem) {
  return defineToolV2({
    name: 'AppendFile',
    description: 'Appends text to the end of a file, creating the file (and any missing parent directories) if it does not exist. Content is written verbatim.',
    operation: 'fs.write',
    model: AppendFileToolV2Model,
    run: (input): ToolV2Result => {
      async function* run(): AsyncGenerator<string, void, unknown> {
        await fs.appendFile(input.path, input.content);
        yield `appended: ${input.path}`;
      }

      return { stdout: fromLines(run()), success: () => true };
    },
  });
}
