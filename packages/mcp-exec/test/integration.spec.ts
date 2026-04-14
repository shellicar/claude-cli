import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createExecServer } from '../src/entry/index.js';

describe('integration', () => {
  let client: Client;

  afterEach(async () => {
    await client?.close();
  });

  async function setup() {
    const server = createExecServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    return client;
  }

  function echoArgs() {
    return {
      name: 'exec' as const,
      arguments: {
        description: 'echo hello',
        steps: [{ commands: [{ program: 'echo', args: ['hello'] }] }],
      },
    };
  }

  describe('successful command', () => {
    it('returns success', async () => {
      const c = await setup();
      const result = await c.callTool(echoArgs());

      expect(result.isError).toBeFalsy();
    });

    it('structuredContent.success is true', async () => {
      const c = await setup();
      const result = await c.callTool(echoArgs());

      const output = result.structuredContent as { success: boolean; results: unknown[] };
      expect(output.success).toBe(true);
    });

    it('structuredContent.results contains step output', async () => {
      const c = await setup();
      const result = await c.callTool(echoArgs());

      const output = result.structuredContent as {
        success: boolean;
        results: { stdout: string; stderr: string; exitCode: number | null; signal: string | null }[];
      };
      expect(output.results).toHaveLength(1);
      expect(output.results[0]?.stdout.trim()).toBe('hello');
      expect(output.results[0]?.exitCode).toBe(0);
    });
  });

  describe('schema validation', () => {
    it('returns an error for empty steps array', async () => {
      const c = await setup();
      const result = await c.callTool({
        name: 'exec',
        arguments: { description: 'empty', steps: [] },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('blocked command', () => {
    it('returns error when command is blocked by validation rules', async () => {
      const c = await setup();
      const result = await c.callTool({
        name: 'exec',
        arguments: {
          description: 'try rm',
          steps: [{ commands: [{ program: 'rm', args: ['-rf', '/'] }] }],
        },
      });

      expect(result.isError).toBe(true);
      const output = result.structuredContent as { success: boolean; results: unknown[] };
      expect(output.success).toBe(false);
    });
  });
});
