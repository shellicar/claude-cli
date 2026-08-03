import type { Readable } from 'node:stream';

/** Collect a readable stream to a UTF-8 string. The convenience helper for when you want output as text. */
export async function fromStream(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/** What a bounded drain saw: the text it kept, and how much went past it. */
export interface DrainedStream {
  text: string;
  /** Every byte the stream produced, including the ones dropped. */
  bytes: number;
  truncated: boolean;
}

/**
 * Collect a readable stream to a UTF-8 string, keeping at most `limit` bytes.
 *
 * Reading continues past the limit and the excess is dropped, which is the whole point: a
 * capture that stops being read stalls the process filling it, so discarding is the only way to
 * bound the memory without stalling the writer. Unbounded, a command that produces output faster
 * than it is consumed reaches V8's maximum string length and takes the whole call down with it.
 */
export async function drainToString(stream: Readable, limit: number): Promise<DrainedStream> {
  const chunks: Buffer[] = [];
  let kept = 0;
  let bytes = 0;

  for await (const chunk of stream) {
    const buffer = chunk as Buffer;
    bytes += buffer.length;
    if (kept < limit) {
      const slice = buffer.length <= limit - kept ? buffer : buffer.subarray(0, limit - kept);
      chunks.push(slice);
      kept += slice.length;
    }
  }

  return { text: Buffer.concat(chunks).toString('utf-8'), bytes, truncated: bytes > kept };
}
