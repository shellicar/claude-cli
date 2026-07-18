#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHistoryServer } from './index.js';

async function main() {
  const server = createHistoryServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
