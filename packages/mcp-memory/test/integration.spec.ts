import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryServer } from '../src/entry/index.js';

describe('integration', () => {
  let client: Client;

  afterEach(async () => {
    await client?.close();
  });

  async function setup() {
    const home = `/tmp/mcp-memory-test-${Math.random().toString(36).slice(2)}`;
    const server = createMemoryServer(home);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    return client;
  }

  function writeArgs(overrides: Partial<{ title: string; body: string; type: string }> = {}) {
    return {
      name: 'WriteMemory' as const,
      arguments: { title: 'a claim', body: 'the body', type: 'trap', keywords: [], intent: 'test', ...overrides },
    };
  }

  it('lists all five memory tools', async () => {
    const c = await setup();
    const { tools } = await c.listTools();

    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['WriteMemory', 'ReadMemory', 'SearchMemory', 'DeleteMemory', 'MemoryTypes']));
  });

  it('writes then reads a memory back by id', async () => {
    const c = await setup();
    const written = await c.callTool(writeArgs());
    const id = (written.structuredContent as { id: string }).id;

    const read = await c.callTool({ name: 'ReadMemory', arguments: { id, intent: 'test' } });

    expect((read.structuredContent as { memory: { title: string } }).memory.title).toBe('a claim');
  });

  it('finds a written memory by search', async () => {
    const c = await setup();
    await c.callTool(writeArgs({ title: 'unique-searchable-title' }));

    const result = await c.callTool({ name: 'SearchMemory', arguments: { query: 'unique-searchable-title', limit: 10, intent: 'test' } });

    const results = (result.structuredContent as { results: { title: string }[] }).results;
    expect(results[0]?.title).toBe('unique-searchable-title');
  });

  it('deleted memory no longer resolves by read', async () => {
    const c = await setup();
    const written = await c.callTool(writeArgs({ title: 'to be deleted' }));
    const id = (written.structuredContent as { id: string }).id;

    await c.callTool({ name: 'DeleteMemory', arguments: { id, intent: 'test' } });
    const read = await c.callTool({ name: 'ReadMemory', arguments: { id, intent: 'test' } });

    expect((read.structuredContent as { found: boolean }).found).toBe(false);
  });

  it('reports type counts', async () => {
    const c = await setup();
    await c.callTool(writeArgs({ type: 'counted-type' }));

    const result = await c.callTool({ name: 'MemoryTypes', arguments: { intent: 'test' } });

    const types = (result.structuredContent as { types: { type: string; count: number }[] }).types;
    expect(types.find((t) => t.type === 'counted-type')?.count).toBe(1);
  });
});
