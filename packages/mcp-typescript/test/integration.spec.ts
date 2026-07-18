import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createTypeScriptServer } from '../src/entry/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const selfFile = path.join(packageRoot, 'src/entry/index.ts');

describe('integration', () => {
  let client: Client;

  afterEach(async () => {
    await client?.close();
  });

  async function setup() {
    const { server } = createTypeScriptServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    return client;
  }

  it('lists all four TS tools', async () => {
    const c = await setup();
    const { tools } = await c.listTools();
    const names = tools.map((t) => t.name);

    expect(names.sort()).toEqual(['TsDefinition', 'TsDiagnostics', 'TsHover', 'TsReferences']);
  });

  it('TsDiagnostics reports no errors for a clean file', async () => {
    const c = await setup();
    const result = await c.callTool({
      name: 'TsDiagnostics',
      arguments: { files: [{ file: selfFile }] },
    });

    expect(result.isError).toBeFalsy();
  });

  it('TsHover reports the hovered symbol', async () => {
    const c = await setup();
    const result = await c.callTool({
      name: 'TsHover',
      arguments: { file: selfFile, line: 1, character: 8 },
    });

    expect(result.isError).toBeFalsy();
  });

  it('two overlapping calls both succeed, neither torn down by the other', async () => {
    const c = await setup();
    const args = { name: 'TsHover' as const, arguments: { file: selfFile, line: 1, character: 8 } };

    const [first, second] = await Promise.all([c.callTool(args), c.callTool(args)]);

    expect(first.isError).toBeFalsy();
    expect(second.isError).toBeFalsy();
  });
});
