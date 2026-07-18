import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = path.join(packageRoot, 'src/entry/cli.ts');

describe('CLI', () => {
  let client: Client;

  afterAll(async () => {
    await client?.close();
  });

  beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: 'tsx',
      args: [cliEntry],
      stderr: 'pipe',
    });
    client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(transport);
    return client;
  });

  it('lists the TS tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('TsDiagnostics');
  });

  it('TsDiagnostics tool has a description', async () => {
    const { tools } = await client.listTools();
    const diagnostics = tools.find((t) => t.name === 'TsDiagnostics');
    expect(diagnostics?.description).toBeTruthy();
  });
});
