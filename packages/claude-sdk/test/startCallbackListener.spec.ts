import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { CallbackRequest, CallbackResponse, CallbackServer, HttpServerFactory } from '../src/private/Client/Auth/startCallbackListener.js';
import { startCallbackListener } from '../src/private/Client/Auth/startCallbackListener.js';

type Handler = (req: CallbackRequest, res: CallbackResponse) => void;

/** A fake HTTP server: binds nothing, and lets the test deliver requests by hand. */
class FakeHttpServer implements CallbackServer {
  #handler: Handler;
  #onError: ((err: Error) => void) | null = null;
  public closed = false;

  public constructor(handler: Handler) {
    this.#handler = handler;
  }

  public listen(_port: number, onListening: () => void): void {
    onListening();
  }

  public address(): AddressInfo {
    return { address: '127.0.0.1', family: 'IPv4', port: 54321 };
  }

  public close(): void {
    this.closed = true;
  }

  public on(_event: 'error', listener: (err: Error) => void): void {
    this.#onError = listener;
  }

  public deliver(url: string): void {
    this.#handler({ url }, { writeHead: () => {}, end: () => {} });
  }

  public fail(err: Error): void {
    this.#onError?.(err);
  }
}

const fakeServerFactory = (): { factory: HttpServerFactory; server: () => FakeHttpServer } => {
  let created: FakeHttpServer | null = null;
  return {
    factory: (handler) => {
      created = new FakeHttpServer(handler);
      return created;
    },
    server: () => {
      if (created === null) {
        throw new Error('server not created');
      }
      return created;
    },
  };
};

describe('startCallbackListener', () => {
  it('resolves the code from the callback request', async () => {
    const { factory, server } = fakeServerFactory();
    const listener = await startCallbackListener(factory);

    server().deliver('/callback?code=abc&state=xyz');

    const expected = { code: 'abc', state: 'xyz' };
    const actual = await listener.code;
    expect(actual).toEqual(expected);
  });

  it('still resolves the callback after an unrelated request hits the port', async () => {
    const { factory, server } = fakeServerFactory();
    const listener = await startCallbackListener(factory);

    server().deliver('/favicon.ico');
    server().deliver('/callback?code=abc&state=xyz');

    const expected = { code: 'abc', state: 'xyz' };
    const actual = await listener.code;
    expect(actual).toEqual(expected);
  });

  it('keeps the server open for the callback after an unrelated request', async () => {
    const { factory, server } = fakeServerFactory();
    await startCallbackListener(factory);

    server().deliver('/favicon.ico');

    const expected = false;
    const actual = server().closed;
    expect(actual).toBe(expected);
  });
});
