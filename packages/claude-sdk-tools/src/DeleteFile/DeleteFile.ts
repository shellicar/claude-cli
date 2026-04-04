import type { ToolDefinition } from '@shellicar/claude-sdk';
import type { IFileSystem } from '../fs/IFileSystem';
import { isNodeError } from '../isNodeError';
import { DeleteFileInputSchema } from './schema';
import type { DeleteFileOutput, DeleteFileResult } from './types';

export function createDeleteFile(fs: IFileSystem): ToolDefinition<typeof DeleteFileInputSchema, DeleteFileOutput> {
  return {
    name: 'DeleteFile',
    operation: 'delete',
    description: 'Delete files from piped content. Pipe Find output into this to delete matched files.',
    input_schema: DeleteFileInputSchema,
    input_examples: [{ content: { type: 'files', values: ['./src/OldFile.ts'] } }],
    handler: async (input): Promise<DeleteFileOutput> => {
      const deleted: string[] = [];
      const errors: DeleteFileResult[] = [];

      for (const value of input.content.values) {
        try {
          await fs.deleteFile(value);
          deleted.push(value);
        } catch (err) {
          if (isNodeError(err, 'ENOENT')) {
            errors.push({ path: value, error: 'File not found' });
          } else if (isNodeError(err, 'EISDIR')) {
            errors.push({ path: value, error: 'Path is a directory \u2014 use DeleteDirectory instead' });
          } else {
            throw err;
          }
        }
      }

      return { deleted, errors, totalDeleted: deleted.length, totalErrors: errors.length };
    },
  };
}
