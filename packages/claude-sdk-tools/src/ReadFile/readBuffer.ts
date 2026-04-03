import type { ReadFileInput, ReadFileOutput } from './types';

export function readBuffer(buffer: Buffer<ArrayBufferLike>, input: ReadFileInput): ReadFileOutput {
  const allLines = buffer.toString('utf-8').split('\n');
  const totalLines = allLines.length;
  const start = input.offset - 1;
  const slice = allLines.slice(start, start + input.limit);

  const startLine = start + 1;
  const endLine = start + slice.length;
  const content = slice
    .map((line, i) => `${String(start + i + 1).padStart(6)}\t${line}`)
    .join('\n');

  return { error: false, content, startLine, endLine, totalLines };
}
