import type { ReadFileInput, ReadFileOutputSuccess } from './types';

export function readBuffer(buffer: Buffer<ArrayBufferLike>, input: ReadFileInput): ReadFileOutputSuccess {
  const allLines = buffer.toString('utf-8').split('\n');
  const totalLines = allLines.length;
  return {
    type: 'content',
    values: allLines,
    totalLines,
    path: input.path,
  };
}
