import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CallbackTimeoutMs } from './consts';

export type CallbackListener = {
  /** The port the OS assigned, for building the redirect URL the browser is sent to. */
  readonly port: number;
  readonly code: Promise<{ code: string; state: string }>;
};

/**
 * Binds the OAuth callback server before the browser is opened, so the redirect URL carries the
 * port that was actually bound. Port 0 lets the OS pick a free one: a previous attempt's server
 * still holding a port can no longer collide, and the redirect URI is not validated by the
 * authorisation server, so any port is acceptable to it.
 *
 * Every failure path settles `code`: a listen failure rejects instead of escaping as an unhandled
 * 'error' event, and the wait is bounded so a login the operator never completes cannot block its
 * caller forever.
 */
export const startCallbackListener = (timeoutMs: number = CallbackTimeoutMs): Promise<CallbackListener> =>
  new Promise((resolveListener, rejectListener) => {
    let settleCode!: (result: { code: string; state: string }) => void;
    let failCode!: (err: Error) => void;
    const code = new Promise<{ code: string; state: string }>((resolve, reject) => {
      settleCode = resolve;
      failCode = reject;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '', `http://localhost:${port()}`);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Login successful. You can close this tab.</h1>');
      close();

      if (!code || !state) {
        failCode(new Error('Missing code or state in callback'));
        return;
      }
      settleCode({ code, state });
    });

    const port = (): number => (server.address() as AddressInfo).port;

    const timer = setTimeout(() => {
      close();
      failCode(new Error(`Timed out after ${timeoutMs}ms waiting for the OAuth callback`));
    }, timeoutMs);

    const close = (): void => {
      clearTimeout(timer);
      server.close();
    };

    server.on('error', (err) => {
      close();
      rejectListener(err);
      failCode(err);
    });

    server.listen(0, () => {
      resolveListener({ port: port(), code });
    });
  });
