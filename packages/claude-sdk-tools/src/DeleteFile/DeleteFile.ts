import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { defineTool, ToolOperation } from '@shellicar/claude-sdk';
import { deleteBatch } from '../deleteBatch';
import { isNodeError } from '../isNodeError';
import { DeleteFileInputSchema, DeleteFileOutputSchema } from './schema';

export function createDeleteFile(fs: IFileSystem) {
  return defineTool({
    name: 'DeleteFile',
    operation: ToolOperation.Delete,
    description: 'Delete files by path.',
    input_schema: DeleteFileInputSchema,
    output_schema: DeleteFileOutputSchema,
    input_examples: [{ files: ['./src/OldFile.ts'] }],
    handler: async (input) => ({
      textContent: await deleteBatch(
        input.files,
        (path) => fs.deleteFile(path),
        (err) => {
          if (isNodeError(err, 'ENOENT')) {
            return 'File not found';
          }
          if (isNodeError(err, 'EISDIR')) {
            return 'Path is a directory \u2014 use DeleteDirectory instead';
          }
        },
      ),
    }),
  });
}
