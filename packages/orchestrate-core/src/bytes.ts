import { Readable } from 'node:stream';

/**
 * A stage's output is bytes, always, whatever produced them.
 *
 * One medium end to end: a process writes bytes, a tool that thinks in lines writes them through
 * `fromLines`, and anything that needs lines back reads them through `lines`. Node then does the
 * buffering and the accounting, in bytes, because that is what a stream carries — no object mode,
 * no counting values and hoping that stands in for memory, and no second mechanism for the one tool
 * that happens to spawn a process.
 */
export const LINE_SEPARATOR = '\n';

/** Bytes from a sequence of lines, each terminated, so the reader can find its own boundaries.
 *
 *  `highWaterMark` is the caller's, not Node's default: this stream sits in front of whatever bounds
 *  the stage, and a bigger buffer here would fill itself regardless of the smaller one behind it,
 *  which is exactly how a bound gets quietly lost. */
export function fromLines(source: AsyncIterable<string> | Iterable<string>, highWaterMark?: number): Readable {
  return Readable.from(
    (async function* () {
      for await (const line of source as AsyncIterable<string>) {
        yield `${line}${LINE_SEPARATOR}`;
      }
    })(),
    { objectMode: false, ...(highWaterMark != null ? { highWaterMark } : {}) },
  );
}

/** A stream destroyed while it was being read is a reader walking away — the ordinary end of a
 *  stage in a pipeline, not something to report as a failure. */
function isTornDown(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'ABORT_ERR' || code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ERR_STREAM_DESTROYED';
}

/**
 * Lines from bytes. A line that never terminates is still a line at end of input, the way a file
 * without a trailing newline holds one.
 *
 * `maxLineBytes` bounds what a single line may cost: without it one value can be arbitrarily large,
 * and nothing counting lines would ever notice. Reaching it ends the line where it stands, so a
 * producer that never writes a separator cannot hold the reader's memory hostage.
 */
export async function* lines(source: AsyncIterable<unknown>, maxLineBytes = 1024 * 1024): AsyncGenerator<string, void, unknown> {
  let partial = '';
  // Node tears a stream down the moment a `for await` over it is left, which rejects whatever read
  // was in flight and leaves that rejection with nowhere to go. So reading and stopping are
  // separated: read without the automatic teardown, then close deliberately once nothing is in
  // flight. A producer is still told to stop the instant its reader leaves.
  const readable = source instanceof Readable ? source : undefined;
  const chunks = readable?.iterator({ destroyOnReturn: false }) ?? source;
  try {
    for await (const chunk of chunks) {
      partial += typeof chunk === 'string' ? chunk : String(chunk);
      let index = partial.indexOf(LINE_SEPARATOR);
      while (index >= 0) {
        yield partial.slice(0, index);
        partial = partial.slice(index + 1);
        index = partial.indexOf(LINE_SEPARATOR);
      }
      if (partial.length >= maxLineBytes) {
        yield partial;
        partial = '';
      }
    }
  } catch (err) {
    if (!isTornDown(err)) {
      throw err;
    }
    return;
  } finally {
    readable?.destroy();
  }
  if (partial.length > 0) {
    yield partial;
  }
}
