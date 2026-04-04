import { rmdirSync } from 'node:fs';
import type { ToolDefinition } from '@shellicar/claude-sdk';
import { expandPath } from '@shellicar/mcp-exec';
import { DeleteDirectoryInputSchema } from './schema';
import type { DeleteDirectoryOutput, DeleteDirectoryResult } from './types';

const isNodeError = (err: unknown, code: string): err is NodeJS.ErrnoException => {
  return err instanceof Error && 'code' in err && err.code === code;
};

export const DeleteDirectory: ToolDefinition<typeof DeleteDirectoryInputSchema, DeleteDirectoryOutput> = {
  name: 'DeleteDirectory',
  description: 'Delete empty directories from piped content. Pipe Find output into this. Directories must be empty — delete files first.',
  input_schema: DeleteDirectoryInputSchema,
  input_examples: [{ content: { type: 'files', values: ['./src/OldDir'] } }],
  handler: async (input): Promise<DeleteDirectoryOutput> => {
    const deleted: string[] = [];
    const errors: DeleteDirectoryResult[] = [];

    for (const value of input.content.values) {
      const path = expandPath(value);
      try {
        rmdirSync(path);
        deleted.push(path);
      } catch (err) {
        if (isNodeError(err, 'ENOENT')) {
          errors.push({ path, error: 'Directory not found' });
        } else if (isNodeError(err, 'ENOTDIR')) {
          errors.push({ path, error: 'Path is not a directory — use DeleteFile instead' });
        } else if (isNodeError(err, 'ENOTEMPTY')) {
          errors.push({ path, error: 'Directory is not empty. Delete the files inside first.' });
        } else {
          throw err;
        }
      }
    }

    return { deleted, errors, totalDeleted: deleted.length, totalErrors: errors.length };
  },
};
