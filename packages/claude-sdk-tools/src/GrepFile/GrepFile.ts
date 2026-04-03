import { readFileSync } from 'node:fs';
import type { ToolDefinition } from '@shellicar/claude-sdk';
import type { GrepFileInput, GrepFileOutput } from './types';
import { GrepFileInputSchema } from './schema';
import { expandPath } from '@shellicar/mcp-exec';
import { fileTypeFromBuffer } from 'file-type';
import { searchLines } from './searchLines';

const isNodeError = (err: unknown, code: string): err is NodeJS.ErrnoException => {
  return err instanceof Error && 'code' in err && err.code === code;
};

export const GrepFile: ToolDefinition<GrepFileInput, GrepFileOutput> = {
  name: 'GrepFile',
  description: 'Search a text file for a regex pattern and return matching lines with context. Lines longer than maxLineLength are truncated around the match.',
  input_schema: GrepFileInputSchema,
  input_examples: [
    { path: '/path/to/file.ts', pattern: 'function\\s+\\w+', context: 3, limit: 10, maxLineLength: 100, skip: 0 },
    { path: '/path/to/file.ts', pattern: 'TODO', context: 2, limit: 10, maxLineLength: 100, skip: 0 },
    { path: '~/file.ts', pattern: 'export', context: 0, limit: 10, maxLineLength: 100, skip: 0 },
  ],
  handler: async (input, _) => {
    const path = expandPath(input.path);

    let buffer: Buffer;
    try {
      buffer = readFileSync(path);
    } catch (err) {
      if (isNodeError(err, 'ENOENT')) {
        return { error: true, message: 'File not found', path } satisfies GrepFileOutput;
      }
      throw err;
    }

    const fileType = await fileTypeFromBuffer(buffer);
    if (fileType) {
      return { error: true, message: `File is binary (${fileType.mime})`, path } satisfies GrepFileOutput;
    }

    if (buffer.subarray(0, 8192).includes(0)) {
      return { error: true, message: 'File appears to be binary', path } satisfies GrepFileOutput;
    }

    let pattern: RegExp;
    try {
      pattern = new RegExp(input.pattern);
    } catch (err) {
      return { error: true, message: `Invalid pattern: ${(err as Error).message}`, path } satisfies GrepFileOutput;
    }

    const lines = buffer.toString('utf-8').split('\n');
    const { matchCount, content } = searchLines(lines, pattern, {
      skip: input.skip,
      limit: input.limit,
      context: input.context,
      maxLineLength: input.maxLineLength,
    });

    return { error: false, matchCount, content } satisfies GrepFileOutput;
  },
};
