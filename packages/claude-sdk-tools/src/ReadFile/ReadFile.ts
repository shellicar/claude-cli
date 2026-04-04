import type { ToolDefinition } from '@shellicar/claude-sdk';
import { expandPath } from '@shellicar/mcp-exec';
import type { IFileSystem } from '../fs/IFileSystem';
import { ReadFileInputSchema } from './schema';
import type { ReadFileOutput } from './types';

export function createReadFile(fs: IFileSystem): ToolDefinition<typeof ReadFileInputSchema, ReadFileOutput> {
  return {
    name: 'ReadFile',
    description: 'Read a text file. Returns all lines as structured content for piping into Head, Tail, Range or Grep.',
    operation: 'read',
    input_schema: ReadFileInputSchema,
    input_examples: [{ path: '/path/to/file.ts' }, { path: '~/file.ts' }, { path: '$HOME/file.ts' }],
    handler: async (input) => {
      const filePath = expandPath(input.path);
      let text: string;
      try {
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
  };
}

const isNodeError = (err: unknown, code: string): err is NodeJS.ErrnoException => {
  return err instanceof Error && 'code' in err && err.code === code;
};
