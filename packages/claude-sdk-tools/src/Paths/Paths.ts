import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { z } from 'zod';
import { defineComposable, PipeStepError } from '../composable';
import type { FileRecord, FilesStream } from '../stream';

export const PathsModel = z.object({
  paths: z.array(z.string()).min(1).describe('Explicit file or directory paths to start the pipe from.'),
});

export function createPaths(fs: IFileSystem) {
  return defineComposable({
    name: 'Paths',
    description: 'Start a pipe from explicit, already-known paths. Source: use when you name the files, rather than discovering them with Find.',
    operation: 'read',
    model: PathsModel,
    input_examples: [{ paths: ['src/index.ts'] }, { paths: ['a.ts', 'b.ts', 'c.ts'] }],
    pipe: { in: null, out: 'files' },
    run: async (model): Promise<FilesStream> => {
      const files: FileRecord[] = [];
      for (const raw of model.paths) {
        const path = expandPath(raw, fs);
        let stat: { size: number; isDirectory(): boolean };
        try {
          stat = await fs.stat(path); // stat follows a symlink; explicit paths resolve to file|dir
        } catch {
          throw new PipeStepError(`Path not found: ${path}`); // fatal (locked error table)
        }
        files.push(stat.isDirectory() ? { path, type: 'dir' } : { path, type: 'file', size: stat.size });
      }
      return { kind: 'files', files };
    },
  });
}
