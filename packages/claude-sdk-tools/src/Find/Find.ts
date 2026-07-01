import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { z } from 'zod';
import { defineComposable } from '../composable';
import { regexPattern } from '../regexPattern';
import type { FilesStream } from '../stream';

export const FindModel = z.object({
  path: z.string().describe('Directory to search. Supports absolute, relative, ~ and $HOME.'),
  pattern: regexPattern('Match against file paths', ['\\.ts$', '\\.(ts|js)$']).optional(),
  type: z.enum(['file', 'directory', 'both']).default('file').describe('Whether to find files, directories, or both'),
  exclude: z.array(z.string()).default(['dist', 'node_modules', '.git']).describe('Directory names to exclude from search'),
  maxDepth: z.number().int().min(1).optional().describe('Maximum directory depth to search'),
  followSymlinks: z.boolean().default(true).describe('When true (default), recurses into directories that are symlinks, discovering files within them. When false, symlinked directories appear in results but are not entered. Symlinked files are always returned regardless of this setting.'),
});

export function createFind(fs: IFileSystem) {
  return defineComposable({
    name: 'Find',
    description: 'Find files or directories under a directory. Excludes node_modules, dist and .git by default. Source: starts a pipe.',
    operation: 'read',
    model: FindModel,
    input_examples: [{ path: '.' }, { path: 'src', pattern: '\\.ts$' }, { path: '.', type: 'directory' }, { path: '.', pattern: '\\.(ts|js)$' }],
    pipe: { in: null, out: 'files' },
    run: async (model): Promise<FilesStream> => {
      const dir = expandPath(model.path, fs);
      // fs.find returns FileRecord[]. A missing/non-directory start point throws here; standalone it
      // is mapped to a fatal object by toStandalone, in a pipe by Pipe's run-loop catch.
      const files = await fs.find(dir, {
        pattern: model.pattern,
        type: model.type,
        exclude: model.exclude,
        maxDepth: model.maxDepth,
        followSymlinks: model.followSymlinks,
      });
      return { kind: 'files', files };
    },
  });
}
