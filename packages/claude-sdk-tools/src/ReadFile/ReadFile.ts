import { readFileSync } from 'node:fs';
import type { ToolDefinition } from '@shellicar/claude-sdk';
import type { ReadFileInput, ReadFileOutput } from './types';
import { ReadFileInputSchema } from './schema';
import { expandPath } from '@shellicar/mcp-exec';
import { fileTypeFromBuffer } from 'file-type';
import { readBuffer } from './readBuffer';

const isNodeError = (err: unknown, code: string): err is NodeJS.ErrnoException => {
  return err instanceof Error && 'code' in err && err.code === code;
};

export const ReadFile: ToolDefinition<ReadFileInput, ReadFileOutput> = {
  name: 'ReadFile',
  description: 'Read a text file, returning line-numbered content with optional offset and limit.',
  input_schema: ReadFileInputSchema,
  input_examples: [
    { path: '/path/to/file', offset: 1, limit: 100 },
    { path: '/path/to/file', limit: 100, offset: 10 },
    { path: '~/file', limit: 1, offset: 1, },
    { path: '$HOME/file', limit: 1, offset: 1, },
  ],
  handler: async (input, _) => {
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
