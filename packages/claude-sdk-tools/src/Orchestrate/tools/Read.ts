import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { defineToolV2 } from '../defineToolV2.js';

const HEADER_BYTES = 4100; // file-type needs ~4100 bytes for detection (mirrors ReadFile/V1 Read)

export const ReadToolV2Model = z.object({});

/** Reads the content of each piped path, skipping directories and binary files (same rule as
 *  V1's `Read` — `grep -I`-style: a binary file has no text lines to contribute). Each line is
 *  emitted as `path:lineNumber:text` — the `grep -Hn` convention. In V1's structured `Stream`,
 *  the path/line association was carried as real fields; in the plain-text world there's no
 *  structural place to put them, so this is the same fallback real Unix tools already use. */
export function createReadToolV2(fs: IFileSystem) {
  return defineToolV2({
    name: 'Read',
    description: 'Reads the content of each piped path, as path:lineNumber:text. Stage.',
    operation: 'fs.read',
    model: ReadToolV2Model,
    run: (_input, upstream, stderr): ToolV2Result<string> => {
      let ok = true;

      async function* readAll(): Stream<string> {
        if (upstream == null) {
          return;
        }
        for await (const value of upstream) {
          const path = String(value);
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
