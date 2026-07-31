import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ISleepProvider } from '@shellicar/claude-core/providers/ISleepProvider';
import { CallbackPath, CallbackTimeoutMs } from './consts';
import type { CallbackListener } from './interfaces';

export type CallbackRequest = {
  readonly url?: string;
};

export type CallbackResponse = {
  writeHead(status: number, headers: Record<string, string>): void;
  end(body: string): void;
};

export type CallbackServer = {
  listen(port: number, onListening: () => void): void;
  address(): AddressInfo | string | null;
  close(): void;
  on(event: 'error', listener: (err: Error) => void): void;
};

export type HttpServerFactory = (handler: (req: CallbackRequest, res: CallbackResponse) => void) => CallbackServer;

export const nodeHttpServerFactory: HttpServerFactory = (handler) => createServer(handler as RequestListener);

/**
 * Binds the OAuth callback server before the browser is opened, so the redirect URL carries the
 * port that was actually bound. Port 0 lets the OS pick a free one: a previous attempt's server
 * still holding a port can no longer collide, and the redirect URI is not validated by the
 * authorisation server, so any port is acceptable to it.
 *
 * Only the redirect itself ends the wait. A browser fetching /favicon.ico, or anything else
 * probing the port, is answered and ignored. An abandoned login (the operator denies, or closes
 * the tab) sends nothing at all, so the timeout is the ordinary way one ends, not an edge case.
 */
export const startCallbackListener = (createHttpServer: HttpServerFactory, sleeper: ISleepProvider, timeoutMs: number = CallbackTimeoutMs): Promise<CallbackListener> =>
  new Promise((resolveListener, rejectListener) => {
    let settleCode!: (result: { code: string; state: string }) => void;
    let failCode!: (err: Error) => void;
    const code = new Promise<{ code: string; state: string }>((resolve, reject) => {
      settleCode = resolve;
      failCode = reject;
    });
    // Until listen's callback fires, nobody holds `code`: a failure before then belongs to the
    // outer promise alone, and rejecting `code` as well would be an unhandled rejection.
    let listening = false;
    const finished = new AbortController();

    const server = createHttpServer((req, res) => {
      const url = new URL(req.url ?? '', 'http://localhost');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const isCallback = url.pathname === CallbackPath && code !== null && state !== null;

      // Connection: close, or the browser's keep-alive holds the listening socket open long after
      // the login is done.
      res.writeHead(isCallback ? 200 : 404, { 'Content-Type': 'text/html', Connection: 'close' });
      res.end(isCallback ? '<h1>Login successful. You can close this tab.</h1>' : '');

      if (!isCallback) {
        return;
      }
      close();
      settleCode({ code, state });
    });

    const close = (): void => {
      finished.abort();
      server.close();
    };

    const timeout = async (): Promise<void> => {
      await sleeper.sleep(timeoutMs, finished.signal);
      if (finished.signal.aborted) {
        return;
      }
      close();
      failCode(new Error(`Timed out after ${timeoutMs}ms waiting for the OAuth callback`));
    };

    server.on('error', (err) => {
      close();
      if (listening) {
        failCode(err);
        return;
      }
      rejectListener(err);
    });

    server.listen(0, () => {
      listening = true;
      resolveListener({ port: (server.address() as AddressInfo).port, code });
      void timeout();
    });
  });
