import { Readable } from 'node:stream';

/** A stage's output is bytes. `fromLines` and `lines` convert at the edges. */
export const LINE_SEPARATOR = '\n';

/** Bytes from a sequence of lines, each terminated. */
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

/** A stream destroyed while being read is a reader walking away, not a failure. */
function isTornDown(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'ABORT_ERR' || code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ERR_STREAM_DESTROYED';
}

/** Lines from bytes. `maxLineBytes` ends a line that has run that long without a separator. */
export async function* lines(source: AsyncIterable<unknown>, maxLineBytes = 1024 * 1024): AsyncGenerator<string, void, unknown> {
  let partial = '';
  // Read without automatic teardown, then close once nothing is in flight: a stream torn down
  // under an in-flight read rejects with nowhere for the rejection to go.
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
