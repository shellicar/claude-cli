import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';
import { describe, expect, it } from 'vitest';
import { ApiStreamError, ConnectionError, HttpError, StreamInterruptedError } from '../src/private/http/errors.js';
import { streamMessages, type TransportParams } from '../src/private/http/transport.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParams(overrides: Partial<TransportParams>): TransportParams {
  return {
    body: { model: 'claude-test', messages: [] },
    requestHeaders: undefined,
    signal: undefined,
    authToken: async () => 'test-token',
    fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
    defaultHeaders: {},
    ...overrides,
  };
}

async function drain(stream: AsyncGenerator<BetaRawMessageStreamEvent>): Promise<BetaRawMessageStreamEvent[]> {
  const out: BetaRawMessageStreamEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

// ---------------------------------------------------------------------------
// streamMessages — connect-phase errors and the success stream
// ---------------------------------------------------------------------------

describe('streamMessages — connect errors', () => {
  it('throws HttpError for a non-2xx response', async () => {
    const fetchFake = (async () => new Response('{}', { status: 429, headers: { 'retry-after': '5' } })) as typeof fetch;

    const actual = drain(streamMessages(makeParams({ fetch: fetchFake })));

    await expect(actual).rejects.toBeInstanceOf(HttpError);
  });

  it('carries the status code on the HttpError', async () => {
    const fetchFake = (async () => new Response('{}', { status: 429, headers: { 'retry-after': '5' } })) as typeof fetch;

    const error = await drain(streamMessages(makeParams({ fetch: fetchFake }))).then(
      () => null,
      (e) => e,
    );
    const actual = (error as HttpError).status;

    expect(actual).toBe(429);
  });

  it('carries the parsed retry-after on the HttpError', async () => {
    const fetchFake = (async () => new Response('{}', { status: 429, headers: { 'retry-after': '5' } })) as typeof fetch;

    const error = await drain(streamMessages(makeParams({ fetch: fetchFake }))).then(
      () => null,
      (e) => e,
    );
    const actual = (error as HttpError).retryAfterMs;

    expect(actual).toBe(5000);
  });

  it('throws ConnectionError when fetch rejects without an abort', async () => {
    const fetchFake = (async () => {
      throw new Error('network down');
    }) as typeof fetch;

    const actual = drain(streamMessages(makeParams({ fetch: fetchFake })));

    await expect(actual).rejects.toBeInstanceOf(ConnectionError);
  });

  it('throws the abort reason when the caller signal is aborted', async () => {
    const reason = new Error('user aborted');
    const controller = new AbortController();
    controller.abort(reason);
    const fetchFake = (async () => {
      throw new Error('aborted');
    }) as typeof fetch;

    const actual = drain(streamMessages(makeParams({ fetch: fetchFake, signal: controller.signal })));

    await expect(actual).rejects.toBe(reason);
  });
});

describe('streamMessages — success stream', () => {
  it('yields the parsed raw events from a 200 SSE body in order', async () => {
    const expected = ['message_start', 'message_stop'];
    const sse = 'event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
    const fetchFake = (async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;

    const events = await drain(streamMessages(makeParams({ fetch: fetchFake })));
    const actual = events.map((e) => e.type);

    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// streamMessages — mid-stream failures after the 200 OK
// ---------------------------------------------------------------------------

describe('streamMessages — mid-stream failures', () => {
  it('wraps a mid-stream socket death as StreamInterruptedError', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        // The undici `terminated` shape: a raw error from reader.read() after the 200 OK.
        throw new TypeError('terminated');
      },
    });
    const fetchFake = (async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;

    const actual = drain(streamMessages(makeParams({ fetch: fetchFake })));

    await expect(actual).rejects.toBeInstanceOf(StreamInterruptedError);
  });

  it('passes a mid-stream ApiStreamError through unwrapped', async () => {
    const sse = 'event: error\ndata: {"type":"error","error":{"type":"overloaded_error"}}\n\n';
    const fetchFake = (async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;

    const actual = drain(streamMessages(makeParams({ fetch: fetchFake })));

    await expect(actual).rejects.toBeInstanceOf(ApiStreamError);
  });

  it('throws the abort reason when the caller aborts mid-stream', async () => {
    const reason = new Error('user aborted');
    const controller = new AbortController();
    controller.abort(reason);
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new TypeError('terminated');
      },
    });
    const fetchFake = (async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;

    const actual = drain(streamMessages(makeParams({ fetch: fetchFake, signal: controller.signal })));

    await expect(actual).rejects.toBe(reason);
  });
});
