import { defineTool } from '@shellicar/claude-sdk';
import { deleteBatch } from '../deleteBatch';
import type { IFileSystem } from '../fs/IFileSystem';
import { isNodeError } from '../isNodeError';
import { DeleteFileInputSchema } from './schema';
import type { DeleteFileOutput } from './types';

export function createDeleteFile(fs: IFileSystem) {
  return defineTool({
    name: 'DeleteFile',
    operation: 'delete',
    description: 'Delete files by path. Pass paths directly as { content: { type: "files", values: ["./path"] } } or pipe Find output into this tool.',
    input_schema: DeleteFileInputSchema,
    input_examples: [{ content: { type: 'files', values: ['./src/OldFile.ts'] } }],
    handler: async (input): Promise<DeleteFileOutput> =>
      deleteBatch(
        input.content.values,
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
  });
}
