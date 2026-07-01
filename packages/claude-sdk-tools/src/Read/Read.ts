import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { defineComposable, PipeStepError } from '../composable';
import type { ContentRecord, ContentStream } from '../stream';

export const ReadModel = z.object({}); // no model inputs — it reads what is piped

const HEADER_BYTES = 4100; // file-type needs ~4100 bytes for detection (mirrors ReadFile)

export function createRead(fs: IFileSystem) {
  return defineComposable({
    name: 'Read',
    description: 'Read the contents of the piped files into the stream. Stage: turns a file list into file contents.',
    operation: 'read',
    model: ReadModel,
    input_examples: [{}],
    pipe: { in: 'files', out: 'content' },
    run: async ({ input }): Promise<ContentStream> => {
      const files: ContentRecord[] = [];
      for (const f of input.files) {
        if (f.type === 'dir') {
          continue; // a directory has no contents to read
        }
        let data: string;
        try {
          data = await fs.readFile(f.path, 'base64');
        } catch {
          throw new PipeStepError(`Cannot read ${f.path}`); // permission, gone → fatal
        }
        const buf = Buffer.from(data, 'base64');
        const sniff = await fileTypeFromBuffer(buf.subarray(0, HEADER_BYTES));
        if (sniff) {
          continue; // binary file: no text lines to contribute, so drop it (grep -I). Read binary with ReadFile, outside a pipe.
        }
        const lines = buf
          .toString('utf8')
          .split('\n')
          .map((text, i) => ({ n: i + 1, text }));
        files.push({ ...f, lines });
      }
      return { kind: 'content', files };
    },
  });
}
