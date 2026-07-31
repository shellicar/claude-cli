import type { AddressInfo } from 'node:net';
import { ISleepProvider } from '@shellicar/claude-core/providers/ISleepProvider';
import { describe, expect, it } from 'vitest';
import type { CallbackRequest, CallbackResponse, CallbackServer, HttpServerFactory } from '../src/private/Client/Auth/startCallbackListener.js';
import { startCallbackListener } from '../src/private/Client/Auth/startCallbackListener.js';

type Handler = (req: CallbackRequest, res: CallbackResponse) => void;

/** A sleep the test ends by hand, so the timeout is provable without waiting one out. */
class FakeSleep extends ISleepProvider {
  #wake: (() => void) | null = null;

  public sleep(_ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.#wake = resolve;
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  public elapse(): void {
    this.#wake?.();
  }
}

/** A fake HTTP server: binds nothing, and lets the test deliver requests by hand. */
class FakeHttpServer implements CallbackServer {
  #handler: Handler;
  #onError: ((err: Error) => void) | null = null;
  #onListening: (() => void) | null = null;
  readonly #bindsImmediately: boolean;
  public closed = false;
  public readonly statuses: number[] = [];

  public constructor(handler: Handler, bindsImmediately: boolean) {
    this.#handler = handler;
    this.#bindsImmediately = bindsImmediately;
  }

  public listen(_port: number, onListening: () => void): void {
    this.#onListening = onListening;
    if (this.#bindsImmediately) {
      onListening();
    }
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
    this.#handler({ url }, { writeHead: (status) => this.statuses.push(status), end: () => {} });
  }

  public bind(): void {
    this.#onListening?.();
  }

  public fail(err: Error): void {
    this.#onError?.(err);
  }
}

const fakeServerFactory = (bindsImmediately = true): { factory: HttpServerFactory; server: () => FakeHttpServer } => {
  let created: FakeHttpServer | null = null;
  return {
    factory: (handler) => {
      created = new FakeHttpServer(handler, bindsImmediately);
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
    const listener = await startCallbackListener(factory, new FakeSleep());

    server().deliver('/callback?code=abc&state=xyz');

    const expected = { code: 'abc', state: 'xyz' };
    const actual = await listener.code;
    expect(actual).toEqual(expected);
  });

  it('still resolves the callback after an unrelated request hits the port', async () => {
    const { factory, server } = fakeServerFactory();
    const listener = await startCallbackListener(factory, new FakeSleep());

    server().deliver('/favicon.ico');
    server().deliver('/callback?code=abc&state=xyz');

    const expected = { code: 'abc', state: 'xyz' };
    const actual = await listener.code;
    expect(actual).toEqual(expected);
  });

  it('keeps the server open for the callback after an unrelated request', async () => {
    const { factory, server } = fakeServerFactory();
    await startCallbackListener(factory, new FakeSleep());

    server().deliver('/favicon.ico');

    const expected = false;
    const actual = server().closed;
    expect(actual).toBe(expected);
  });

  it('answers an unrelated request with 404', async () => {
    const { factory, server } = fakeServerFactory();
    await startCallbackListener(factory, new FakeSleep());

    server().deliver('/favicon.ico');

    const expected = [404];
    const actual = server().statuses;
    expect(actual).toEqual(expected);
  });

  it('ignores a callback that carries no code', async () => {
    const { factory, server } = fakeServerFactory();
    await startCallbackListener(factory, new FakeSleep());

    server().deliver('/callback');

    const expected = false;
    const actual = server().closed;
    expect(actual).toBe(expected);
  });

  it('fails the wait once the timeout elapses', async () => {
    const { factory } = fakeServerFactory();
    const sleep = new FakeSleep();
    const listener = await startCallbackListener(factory, sleep, 60_000);

    sleep.elapse();

    await expect(listener.code).rejects.toThrow('Timed out after 60000ms waiting for the OAuth callback');
  });

  it('closes the server once the timeout elapses', async () => {
    const { factory, server } = fakeServerFactory();
    const sleep = new FakeSleep();
    const listener = await startCallbackListener(factory, sleep);

    sleep.elapse();
    await listener.code.catch(() => {});

    const expected = true;
    const actual = server().closed;
    expect(actual).toBe(expected);
  });

  it('rejects when the server never binds', async () => {
    const { factory, server } = fakeServerFactory(false);
    const listening = startCallbackListener(factory, new FakeSleep());

    server().fail(new Error('EADDRINUSE'));

    await expect(listening).rejects.toThrow('EADDRINUSE');
  });

  it('fails the wait when the server errors after binding', async () => {
    const { factory, server } = fakeServerFactory();
    const listener = await startCallbackListener(factory, new FakeSleep());

    server().fail(new Error('socket died'));

    await expect(listener.code).rejects.toThrow('socket died');
  });
});
