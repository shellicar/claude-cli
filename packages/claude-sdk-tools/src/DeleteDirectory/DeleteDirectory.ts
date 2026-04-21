import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { defineTool } from '@shellicar/claude-sdk';
import { deleteBatch } from '../deleteBatch';
import { isNodeError } from '../isNodeError';
import { DeleteDirectoryInputSchema } from './schema';
import type { DeleteDirectoryOutput } from './types';

export function createDeleteDirectory(fs: IFileSystem) {
  return defineTool({
    name: 'DeleteDirectory',
    description: 'Delete empty directories by path. Pass paths directly as { content: { type: "files", values: ["./path"] } } or pipe Find output into this tool. Directories must be empty — delete files first.',
    operation: 'delete',
    input_schema: DeleteDirectoryInputSchema,
    input_examples: [{ content: { type: 'files', values: ['./src/OldDir'] } }],
    handler: async (input): Promise<DeleteDirectoryOutput> =>
      deleteBatch(
        input.content.values,
        (path) => fs.deleteDirectory(path),
        (err) => {
          if (isNodeError(err, 'ENOENT')) {
            return 'Directory not found';
          }
          if (isNodeError(err, 'ENOTDIR')) {
            return 'Path is not a directory \u2014 use DeleteFile instead';
          }
          if (isNodeError(err, 'ENOTEMPTY')) {
            return 'Directory is not empty. Delete the files inside first.';
          }
        },
      ),
  });
}
