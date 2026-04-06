import { createServer } from 'node:http';

export const waitForCallback = (port: number): Promise<{ code: string; state: string }> =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '', `http://localhost:${port}`);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Login successful. You can close this tab.</h1>');
      server.close();

      if (!code || !state) {
        reject(new Error('Missing code or state in callback'));
        return;
      }
      resolve({ code, state });
    });

    server.listen(port);
  });
