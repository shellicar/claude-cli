import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { pathSchema } from '@shellicar/claude-sdk';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { defineToolV2 } from '../defineToolV2.js';

const HEADER_BYTES = 4100; // file-type needs ~4100 bytes for detection (mirrors ReadFile/V1 Read)

export const ReadToolV2Model = z.object({
  paths: z.array(pathSchema).min(1).describe('File paths to read. Feed from Find/Paths via Xargs, not a direct pipe \u2014 real Unix has no tool that reads piped names as files to open (that\u2019s always xargs + the reader, e.g. `find | xargs cat`).'),
});

/** Reads the content of each named path, skipping directories and binary files (same rule as
 *  V1's `Read` \u2014 `grep -I`-style: a binary file has no text lines to contribute). Each line is
 *  emitted as `path:lineNumber:text` \u2014 the `grep -Hn` convention.
 *
 *  Takes `paths` as its own marked field, never an implicit upstream-as-paths read: real Unix
 *  has no tool that treats piped lines as filenames to open on its own (`cat` doesn't; that
 *  behaviour is always `xargs` converting the list into arguments for the reader). Taking
 *  paths only through a real field is also what lets `collectPaths` see them for Policy \u2014
 *  a value smuggled through `upstream` was invisible to any path-scoped policy rule. */
export function createReadToolV2(fs: IFileSystem) {
  return defineToolV2({
    name: 'Read',
    description: 'Reads the content of each named path, as path:lineNumber:text.',
    operation: 'fs.read',
    model: ReadToolV2Model,
    run: (input, _upstream, stderr): ToolV2Result<string> => {
      let ok = true;

      async function* readAll(): Stream<string> {
        for (const path of input.paths) {
          let stat: Awaited<ReturnType<IFileSystem['stat']>>;
          try {
            stat = await fs.stat(path);
          } catch (err) {
            ok = false;
            stderr.push(err instanceof Error ? err.message : String(err));
            continue;
          }
          if (stat.isDirectory()) {
            continue; // a directory has no contents to read
          }

          let data: string;
          try {
            data = await fs.readFile(path, 'base64');
          } catch (err) {
            ok = false;
            stderr.push(err instanceof Error ? err.message : String(err));
            continue;
          }

          const buf = Buffer.from(data, 'base64');
          const sniff = await fileTypeFromBuffer(buf.subarray(0, HEADER_BYTES));
          if (sniff) {
            continue; // binary file: read it with ReadBinaryFile outside a pipe instead
          }

          const lines = buf.toString('utf8').split('\n');
          for (let i = 0; i < lines.length; i++) {
            yield `${path}:${i + 1}:${lines[i]}`;
          }
        }
      }

      return { stdout: readAll(), success: () => ok };
    },
  });
}
