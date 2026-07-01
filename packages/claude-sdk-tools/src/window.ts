import type { Stream } from './stream';

/** Apply a slice at the current grain (the locked grain rule): files before Read, lines-per-file
 *  after. `take` is the windowing operation, applied to whichever list the stream carries.
 *
 *  On the content grain, a file left with no lines after the window is dropped from the stream
 *  (grep-style: no surviving content, no empty path header). */
export function windowGrain(input: Stream, take: <T>(xs: T[]) => T[]): Stream {
  if (input.kind === 'files') {
    return { kind: 'files', files: take(input.files) };
  }
  const files = input.files.map((f) => ({ ...f, lines: take(f.lines) })).filter((f) => f.lines.length > 0);
  return { kind: 'content', files };
}
