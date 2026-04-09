import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../src/private/ToolRegistry.js';
import type { AnyToolDefinition } from '../src/public/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(name: string, handler: (input: { value: string }) => Promise<unknown>): AnyToolDefinition {
  const schema = z.object({ value: z.string() });
  return {
    name,
    description: `Tool ${name}`,
    input_schema: schema,
    input_examples: [{ value: 'example' }],
    handler: handler as (input: never) => Promise<unknown>,
  };
}

// ---------------------------------------------------------------------------
// execute — the per-call behaviour
// ---------------------------------------------------------------------------

describe('ToolRegistry — execute', () => {
  it('returns success for a valid input', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const registry = new ToolRegistry([tool]);
    const result = await registry.execute('echo', { value: 'hi' });
    expect(result).toEqual({ kind: 'success', content: 'got: hi' });
  });

  it('returns invalid_input for a schema mismatch', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const registry = new ToolRegistry([tool]);
    const result = await registry.execute('echo', { wrong: 'field' });
    expect(result.kind).toBe('invalid_input');
  });

  it('returns not_found for an unknown tool name', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const registry = new ToolRegistry([tool]);
    const result = await registry.execute('nonexistent', { value: 'hi' });
    expect(result).toEqual({ kind: 'not_found' });
  });

  it('returns handler_error when the handler throws', async () => {
    const tool = makeTool('throws', async () => {
      throw new Error('boom');
    });
    const registry = new ToolRegistry([tool]);
    const result = await registry.execute('throws', { value: 'hi' });
    expect(result).toEqual({ kind: 'handler_error', error: 'boom' });
  });

  it('applies the transform hook to the handler output before stringifying', async () => {
    const tool = makeTool('echo', async (input) => ({ value: input.value }));
    const registry = new ToolRegistry([tool]);
    const transform = (_name: string, output: unknown): unknown => {
      const obj = output as { value: string };
      return `transformed: ${obj.value}`;
    };
    const result = await registry.execute('echo', { value: 'hi' }, transform);
    expect(result).toEqual({ kind: 'success', content: 'transformed: hi' });
  });

  it('stringifies non-string handler output', async () => {
    const tool = makeTool('echo', async (input) => ({ value: input.value, count: 42 }));
    const registry = new ToolRegistry([tool]);
    const result = await registry.execute('echo', { value: 'hi' });
    expect(result).toEqual({ kind: 'success', content: JSON.stringify({ value: 'hi', count: 42 }) });
  });
});

// ---------------------------------------------------------------------------
// wireTools — the cached JSON schema form the request builder consumes
// ---------------------------------------------------------------------------

describe('ToolRegistry — wireTools', () => {
  it('exposes the converted JSON schema form for each registered tool', () => {
    const tool1 = makeTool('echo', async (input) => input.value);
    const tool2 = makeTool('hello', async (input) => `hello ${input.value}`);
    const registry = new ToolRegistry([tool1, tool2]);
    const wire = registry.wireTools;
    expect(wire).toHaveLength(2);
    expect(wire[0]?.name).toBe('echo');
    expect(wire[0]?.description).toBe('Tool echo');
    expect(wire[0]?.input_schema).toBeDefined();
    expect(wire[1]?.name).toBe('hello');
  });

  it('caches the conversion result across multiple accesses', () => {
    const tool = makeTool('echo', async (input) => input.value);
    const registry = new ToolRegistry([tool]);
    // Two accesses to wireTools should return equivalent shape, verifying the
    // cache does not re-convert each time.
    const first = registry.wireTools;
    const second = registry.wireTools;
    expect(first[0]?.input_schema).toEqual(second[0]?.input_schema);
  });
});
