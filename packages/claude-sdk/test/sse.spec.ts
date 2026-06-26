import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';
import { describe, expect, it } from 'vitest';
import { ApiStreamError } from '../src/private/http/errors.js';
import { findFrameBoundary, parseFrame, parseSse, type SseFrame } from '../src/private/http/sse.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function streamFrom(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect(stream: AsyncGenerator<BetaRawMessageStreamEvent>): Promise<BetaRawMessageStreamEvent[]> {
  const out: BetaRawMessageStreamEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

// ---------------------------------------------------------------------------
// findFrameBoundary — exhaustive: every branch of the LF/CRLF selection
// ---------------------------------------------------------------------------

describe('findFrameBoundary', () => {
  it('finds an LF-LF boundary with length 2', () => {
    const expected = { index: 2, length: 2 };

    const actual = findFrameBoundary('ab\n\ncd');

    expect(actual).toEqual(expected);
  });

  it('finds a CRLF-CRLF boundary with length 4 when no LF-LF is present', () => {
    const expected = { index: 2, length: 4 };

    const actual = findFrameBoundary('ab\r\n\r\ncd');

    expect(actual).toEqual(expected);
  });

  it('chooses the CRLF boundary when it occurs before the LF boundary', () => {
    const expected = { index: 1, length: 4 };

    const actual = findFrameBoundary('a\r\n\r\nb\n\nc');

    expect(actual).toEqual(expected);
  });

  it('chooses the LF boundary when it occurs before the CRLF boundary', () => {
    const expected = { index: 1, length: 2 };

    const actual = findFrameBoundary('a\n\nb\r\n\r\nc');

    expect(actual).toEqual(expected);
  });

  it('returns null when no boundary is present', () => {
    const expected = null;

    const actual = findFrameBoundary('no boundary here');

    expect(actual).toEqual(expected);
  });

  it('finds a boundary at index 0', () => {
    const expected = { index: 0, length: 2 };

    const actual = findFrameBoundary('\n\nrest');

    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// parseFrame — exhaustive: field parsing and both return conditions
// ---------------------------------------------------------------------------

describe('parseFrame', () => {
  it('captures both event and data fields', () => {
    const expected = { event: 'message_stop', data: '{}' } satisfies SseFrame;

    const actual = parseFrame('event: message_stop\ndata: {}');

    expect(actual).toEqual(expected);
  });

  it('captures data with a null event when no event field is present', () => {
    const expected = { event: null, data: 'payload' } satisfies SseFrame;

    const actual = parseFrame('data: payload');

    expect(actual).toEqual(expected);
  });

  it('joins multiple data lines with a newline', () => {
    const expected = { event: null, data: 'line1\nline2' } satisfies SseFrame;

    const actual = parseFrame('data: line1\ndata: line2');

    expect(actual).toEqual(expected);
  });

  it('strips a single leading space after the data colon', () => {
    const expected = { event: null, data: 'x' } satisfies SseFrame;

    const actual = parseFrame('data: x');

    expect(actual).toEqual(expected);
  });

  it('keeps data intact when there is no space after the colon', () => {
    const expected = { event: null, data: 'x' } satisfies SseFrame;

    const actual = parseFrame('data:x');

    expect(actual).toEqual(expected);
  });

  it('ignores a comment line and still captures data', () => {
    const expected = { event: null, data: 'x' } satisfies SseFrame;

    const actual = parseFrame(': a comment\ndata: x');

    expect(actual).toEqual(expected);
  });

  it('strips a trailing carriage return before parsing the field', () => {
    const expected = { event: 'message_stop', data: '{}' } satisfies SseFrame;

    const actual = parseFrame('event: message_stop\r\ndata: {}\r');

    expect(actual).toEqual(expected);
  });

  it('captures nothing from a line with no colon', () => {
    const expected = { event: null, data: 'x' } satisfies SseFrame;

    const actual = parseFrame('noColonLine\ndata: x');

    expect(actual).toEqual(expected);
  });

  it('returns null for an empty or comments-only block', () => {
    const expected = null;

    const actual = parseFrame(': only a comment');

    expect(actual).toEqual(expected);
  });

  it('returns a frame with empty data when an event has no data line', () => {
    const expected = { event: 'ping', data: '' } satisfies SseFrame;

    const actual = parseFrame('event: ping');

    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// parseSse — framing the byte stream into parsed events
// ---------------------------------------------------------------------------

describe('parseSse', () => {
  it('yields one event when a frame is split across two reads', async () => {
    const expected = ['message_stop'];

    const events = await collect(parseSse(streamFrom('event: message_stop\ndata: {"ty', 'pe":"message_stop"}\n\n')));
    const actual = events.map((e) => e.type);

    expect(actual).toEqual(expected);
  });

  it('yields each complete frame in a single buffer in order', async () => {
    const expected = ['message_start', 'message_stop'];

    const events = await collect(parseSse(streamFrom('event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n')));
    const actual = events.map((e) => e.type);

    expect(actual).toEqual(expected);
  });

  it('joins a multi-line data payload into one event', async () => {
    const expected = ['message_stop'];

    const events = await collect(parseSse(streamFrom('data: {"type":\ndata: "message_stop"}\n\n')));
    const actual = events.map((e) => e.type);

    expect(actual).toEqual(expected);
  });

  it('skips a ping frame', async () => {
    const expected = ['message_stop'];

    const events = await collect(parseSse(streamFrom('event: ping\ndata: {}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n')));
    const actual = events.map((e) => e.type);

    expect(actual).toEqual(expected);
  });

  it('ignores a comment line within a frame', async () => {
    const expected = ['message_stop'];

    const events = await collect(parseSse(streamFrom(': heartbeat\ndata: {"type":"message_stop"}\n\n')));
    const actual = events.map((e) => e.type);

    expect(actual).toEqual(expected);
  });

  it('throws ApiStreamError on an error frame', async () => {
    const actual = collect(parseSse(streamFrom('event: error\ndata: {"error":{"type":"overloaded_error"}}\n\n')));

    await expect(actual).rejects.toBeInstanceOf(ApiStreamError);
  });

  it('carries the error type on the thrown ApiStreamError', async () => {
    const expected = 'overloaded_error';

    const error = await collect(parseSse(streamFrom('event: error\ndata: {"error":{"type":"overloaded_error"}}\n\n'))).then(
      () => null,
      (e) => e,
    );
    const actual = (error as ApiStreamError).type;

    expect(actual).toBe(expected);
  });

  it('flushes a trailing frame that lacks a terminating blank line', async () => {
    const expected = ['message_stop'];

    const events = await collect(parseSse(streamFrom('event: message_stop\ndata: {"type":"message_stop"}\n')));
    const actual = events.map((e) => e.type);

    expect(actual).toEqual(expected);
  });

  it('frames events delimited by CRLF', async () => {
    const expected = ['message_stop'];

    const events = await collect(parseSse(streamFrom('event: message_stop\r\ndata: {"type":"message_stop"}\r\n\r\n')));
    const actual = events.map((e) => e.type);

    expect(actual).toEqual(expected);
  });

  it('throws ApiStreamError on a malformed data frame', async () => {
    const actual = collect(parseSse(streamFrom('event: message_stop\ndata: {not valid json}\n\n')));

    await expect(actual).rejects.toBeInstanceOf(ApiStreamError);
  });

  it('cancels the underlying stream when the consumer stops reading early', async () => {
    const expected = true;
    let cancelled = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: message_start\ndata: {"type":"message_start"}\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });

    const events = parseSse(stream);
    await events.next();
    await events.return(undefined);
    const actual = cancelled;

    expect(actual).toBe(expected);
  });
});
