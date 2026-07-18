#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMemoryServer } from './index.js';

async function main() {
  const server = createMemoryServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
