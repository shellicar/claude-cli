import { rmSync } from 'node:fs';
import type { ToolDefinition } from '@shellicar/claude-sdk';
import { expandPath } from '@shellicar/mcp-exec';
import { DeleteFileInputSchema } from './schema';
import type { DeleteFileOutput, DeleteFileResult } from './types';

const isNodeError = (err: unknown, code: string): err is NodeJS.ErrnoException => {
  return err instanceof Error && 'code' in err && err.code === code;
};

export const DeleteFile: ToolDefinition<typeof DeleteFileInputSchema, DeleteFileOutput> = {
  name: 'DeleteFile',
  operation: 'delete',
  description: 'Delete files from piped content. Pipe Find output into this to delete matched files.',
  input_schema: DeleteFileInputSchema,
  input_examples: [{ content: { type: 'files', values: ['./src/OldFile.ts'] } }],
  handler: async (input): Promise<DeleteFileOutput> => {
    const deleted: string[] = [];
    const errors: DeleteFileResult[] = [];

    for (const value of input.content.values) {
      const path = expandPath(value);
      try {
        rmSync(path);
        deleted.push(path);
      } catch (err) {
        if (isNodeError(err, 'ENOENT')) {
          errors.push({ path, error: 'File not found' });
        } else if (isNodeError(err, 'EISDIR')) {
          errors.push({ path, error: 'Path is a directory — use DeleteDirectory instead' });
        } else {
          throw err;
        }
      }
    }

    return { deleted, errors, totalDeleted: deleted.length, totalErrors: errors.length };
  },
};
