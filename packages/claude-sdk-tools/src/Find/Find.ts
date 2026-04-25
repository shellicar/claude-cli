import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { defineTool } from '@shellicar/claude-sdk';
import { isNodeError } from '../isNodeError';
import { FindInputSchema, FindOutputSchema } from './schema';
import type { FindOutput, FindOutputSuccess } from './types';

export function createFind(fs: IFileSystem) {
  return defineTool({
    operation: 'read',
    name: 'Find',
    description: 'Find files or directories. Excludes node_modules, dist and .git by default. Output can be piped into Grep.',
    input_schema: FindInputSchema,
    output_schema: FindOutputSchema,
    input_examples: [{ path: '.' }, { path: './src', pattern: '.ts$' }, { path: '.', type: 'directory' }, { path: '.', pattern: '.(ts|js)$' }],
    handler: async (input) => {
      const dir = expandPath(input.path, fs);
      let paths: string[];
      try {
        paths = await fs.find(dir, {
          pattern: input.pattern,
          type: input.type,
          exclude: input.exclude,
          maxDepth: input.maxDepth,
          followSymlinks: input.followSymlinks,
        });
      } catch (err) {
        if (isNodeError(err, 'ENOENT')) {
          return { textContent: { error: true, message: 'Directory not found', path: dir } satisfies FindOutput };
        }
        if (isNodeError(err, 'ENOTDIR')) {
          return { textContent: { error: true, message: 'Path is not a directory', path: dir } satisfies FindOutput };
        }
        throw err;
      }

      return { textContent: { type: 'files', values: paths } satisfies FindOutputSuccess };
    },
  });
}
