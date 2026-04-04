import type { ReadFileInput, ReadFileOutputSuccess } from './types';

export function readBuffer(buffer: Buffer<ArrayBufferLike>, input: ReadFileInput): ReadFileOutputSuccess {
  const allLines = buffer.toString('utf-8').split('\n');
  const totalLines = allLines.length;
  const lines = allLines.map((text, i) => ({ n: i + 1, text }));
  return {
    lines,
    totalLines,
    path: input.path,
  };
}
