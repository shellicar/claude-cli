import type { ToolDefinition } from '@shellicar/claude-sdk';
import { deleteBatch } from '../deleteBatch';
import type { IFileSystem } from '../fs/IFileSystem';
import { isNodeError } from '../isNodeError';
import { DeleteDirectoryInputSchema } from './schema';
import type { DeleteDirectoryOutput } from './types';

export function createDeleteDirectory(fs: IFileSystem): ToolDefinition<typeof DeleteDirectoryInputSchema, DeleteDirectoryOutput> {
  return {
    name: 'DeleteDirectory',
    description: 'Delete empty directories from piped content. Pipe Find output into this. Directories must be empty \u2014 delete files first.',
    operation: 'delete',
    input_schema: DeleteDirectoryInputSchema,
    input_examples: [{ content: { type: 'files', values: ['./src/OldDir'] } }],
    handler: async (input): Promise<DeleteDirectoryOutput> =>
      deleteBatch(input.content.values, (path) => fs.deleteDirectory(path), (err) => {
        if (isNodeError(err, 'ENOENT')) return 'Directory not found';
        if (isNodeError(err, 'ENOTDIR')) return 'Path is not a directory \u2014 use DeleteFile instead';
        if (isNodeError(err, 'ENOTEMPTY')) return 'Directory is not empty. Delete the files inside first.';
      }),
  };
}
