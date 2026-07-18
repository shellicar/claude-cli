#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createTypeScriptServer } from './index.js';

async function main() {
  const { server, tsService } = createTypeScriptServer();
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    // Backstop for the abnormal paths a per-call blockEnded() can't reach:
    // the process is signalled or the client drops the stdio pipe mid-call,
    // which would otherwise leave a tsserver child orphaned.
    await tsService.blockEnded();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  transport.onclose = () => {
    void shutdown();
  };

  await server.connect(transport);
}

main().catch(console.error);
