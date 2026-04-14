import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = path.join(packageRoot, 'src/entry/cli.ts');

describe('CLI', () => {
  let client: Client;

  afterEach(async () => {
    await client?.close();
  });

  async function setup() {
    const transport = new StdioClientTransport({
      command: 'tsx',
      args: [cliEntry],
      stderr: 'pipe',
    });
    client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(transport);
    return client;
  }

  it('lists the exec tool', async () => {
    const c = await setup();
    const { tools } = await c.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('exec');
  });

  it('exec tool has a description', async () => {
    const c = await setup();
    const { tools } = await c.listTools();
    const exec = tools.find((t) => t.name === 'exec');
    expect(exec?.description).toBeTruthy();
  });
});
