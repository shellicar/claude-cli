import { defineTool } from '@shellicar/claude-sdk';
import { expandPath } from '../expandPath';
import type { IFileSystem } from '../fs/IFileSystem';
import { isNodeError } from '../isNodeError';
import { ReadFileInputSchema } from './schema';
import type { ReadFileOutput } from './types';

const MAX_FILE_BYTES = 500_000;

export function createReadFile(fs: IFileSystem) {
  return defineTool({
    name: 'ReadFile',
    description: 'Read a text file. Returns all lines as structured content for piping into Head, Tail, Range or Grep.',
    operation: 'read',
    input_schema: ReadFileInputSchema,
    input_examples: [{ path: '/path/to/file.ts' }, { path: '~/file.ts' }, { path: '$HOME/file.ts' }],
    handler: async (input) => {
      const filePath = expandPath(input.path, fs);
      let text: string;
      try {
        const { size } = await fs.stat(filePath);
        if (size > MAX_FILE_BYTES) {
          const kb = Math.round(size / 1024);
          return {
            error: true,
            message: `File is too large to read (${kb}KB, max ${MAX_FILE_BYTES / 1000}KB). Use Head/Tail/Range for specific lines, or Grep/SearchFiles to locate content.`,
            path: filePath,
          } satisfies ReadFileOutput;
        }
        text = await fs.readFile(filePath);
      } catch (err) {
        if (isNodeError(err, 'ENOENT')) {
          return { error: true, message: 'File not found', path: filePath } satisfies ReadFileOutput;
        }
        throw err;
      }

      const allLines = text.split('\n');
      return {
        type: 'content',
        values: allLines,
        totalLines: allLines.length,
        path: filePath,
      } satisfies ReadFileOutput;
    },
  });
}
