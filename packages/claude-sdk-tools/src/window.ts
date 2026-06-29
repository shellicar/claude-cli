import type { Stream } from './stream';

/** Apply a slice at the current grain (the locked grain rule): files before Read, lines-per-file
 *  after. `take` is the windowing operation, applied to whichever list the stream carries. */
export function windowGrain(input: Stream, take: <T>(xs: T[]) => T[]): Stream {
  return input.kind === 'files' ? { kind: 'files', files: take(input.files) } : { kind: 'content', files: input.files.map((f) => ({ ...f, lines: take(f.lines) })) };
}
