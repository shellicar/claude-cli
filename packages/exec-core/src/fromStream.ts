import type { Readable } from 'node:stream';

/** Collect a readable stream to a UTF-8 string. The convenience helper for when you want output as text. */
export async function fromStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}
