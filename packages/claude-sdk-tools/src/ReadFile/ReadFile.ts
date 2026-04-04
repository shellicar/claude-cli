import { readFileSync } from 'node:fs';
import type { ToolDefinition } from '@shellicar/claude-sdk';
import { expandPath } from '@shellicar/mcp-exec';
import { fileTypeFromBuffer } from 'file-type';
import { readBuffer } from './readBuffer';
import { ReadFileInputSchema } from './schema';
import type { ReadFileInput, ReadFileOutput } from './types';

const isNodeError = (err: unknown, code: string): err is NodeJS.ErrnoException => {
  return err instanceof Error && 'code' in err && err.code === code;
};

export const ReadFile: ToolDefinition<typeof ReadFileInputSchema, ReadFileOutput> = {
  name: 'ReadFile',
  description: 'Read a text file. Returns all lines as structured content for piping into Head, Tail, Range or Grep.',
  input_schema: ReadFileInputSchema,
  input_examples: [{ path: '/path/to/file.ts' }, { path: '~/file.ts' }, { path: '$HOME/file.ts' }],
  handler: async (input) => {
    const path = expandPath(input.path);

    let buffer: Buffer;
    try {
      buffer = readFileSync(path);
    } catch (err) {
      if (isNodeError(err, 'ENOENT')) {
        return { error: true, message: 'File not found', path } satisfies ReadFileOutput;
      }
      throw err;
    }

    const fileType = await fileTypeFromBuffer(buffer);
    if (fileType) {
      return { error: true, message: `File is binary (${fileType.mime})`, path } satisfies ReadFileOutput;
    }

    if (buffer.subarray(0, 8192).includes(0)) {
      return { error: true, message: 'File appears to be binary', path } satisfies ReadFileOutput;
    }

    return readBuffer(buffer, input);
  },
};
