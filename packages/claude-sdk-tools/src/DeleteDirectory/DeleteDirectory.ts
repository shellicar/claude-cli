import type { ToolDefinition } from '@shellicar/claude-sdk';
import type { IFileSystem } from '../fs/IFileSystem';
import { DeleteDirectoryInputSchema } from './schema';
import type { DeleteDirectoryOutput, DeleteDirectoryResult } from './types';

const isNodeError = (err: unknown, code: string): err is NodeJS.ErrnoException => {
  return err instanceof Error && 'code' in err && err.code === code;
};

export function createDeleteDirectory(fs: IFileSystem): ToolDefinition<typeof DeleteDirectoryInputSchema, DeleteDirectoryOutput> {
  return {
    name: 'DeleteDirectory',
    description: 'Delete empty directories from piped content. Pipe Find output into this. Directories must be empty \u2014 delete files first.',
    operation: 'delete',
    input_schema: DeleteDirectoryInputSchema,
    input_examples: [{ content: { type: 'files', values: ['./src/OldDir'] } }],
    handler: async (input): Promise<DeleteDirectoryOutput> => {
      const deleted: string[] = [];
      const errors: DeleteDirectoryResult[] = [];

      for (const value of input.content.values) {
        try {
          await fs.deleteDirectory(value);
          deleted.push(value);
        } catch (err) {
          if (isNodeError(err, 'ENOENT')) {
            errors.push({ path: value, error: 'Directory not found' });
          } else if (isNodeError(err, 'ENOTDIR')) {
            errors.push({ path: value, error: 'Path is not a directory \u2014 use DeleteFile instead' });
          } else if (isNodeError(err, 'ENOTEMPTY')) {
            errors.push({ path: value, error: 'Directory is not empty. Delete the files inside first.' });
          } else {
            throw err;
          }
        }
      }

      return { deleted, errors, totalDeleted: deleted.length, totalErrors: errors.length };
    },
  };
}
