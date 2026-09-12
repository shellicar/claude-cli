import { StringDecoder } from 'node:string_decoder';
import type { Reader } from '@shellicar/orchestrate-core';

/** What separates one item from the next in what a tool writes, and what whoever reads them back
 *  splits on. Deliberately not the platform's: these bytes are a protocol between two ends that are
 *  both ours, so a machine whose convention is CRLF must still write what the other end reads. */
export const NEWLINE = '\n';

/** Reads a stream as the lines it holds, without their terminator. A chunk is an arbitrary slice of
 *  bytes, so a line spans as many of them as it needs to and a character split down the middle is
 *  still one character: the answer depends on the content, never on how it arrived. A last line
 *  with no terminator on it is still a line, since that is what a file written without a trailing
 *  newline holds. */
export async function* readLines(from: Reader): AsyncGenerator<string, void, unknown> {
  const decoder = new StringDecoder('utf8');
  let partial = '';

  for (let chunk = await from.read(); chunk != null; chunk = await from.read()) {
    partial += decoder.write(chunk);
    let at = partial.indexOf(NEWLINE);
    while (at >= 0) {
      yield partial.slice(0, at);
      partial = partial.slice(at + 1);
      at = partial.indexOf(NEWLINE);
    }
  }

  partial += decoder.end();
  if (partial.length > 0) {
    yield partial;
  }
}
