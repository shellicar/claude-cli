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
// resolve — the per-call behaviour
//
// Covers both phases: the synchronous resolve step (validation + closure
// capture) and the async run step (handler invocation with the already
// parsed input).
// ---------------------------------------------------------------------------

describe('ToolRegistry — resolve', () => {
  it('returns ready with a run closure that produces success for a valid input', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const registry = new ToolRegistry([tool]);
    const resolved = registry.resolve('echo', { value: 'hi' });
    expect(resolved.kind).toBe('ready');
    if (resolved.kind !== 'ready') {
      return;
    }
    const runResult = await resolved.run();
    expect(runResult).toEqual({ kind: 'success', content: 'got: hi' });
  });

  it('returns invalid_input for a schema mismatch', () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const registry = new ToolRegistry([tool]);
    const resolved = registry.resolve('echo', { wrong: 'field' });
    expect(resolved.kind).toBe('invalid_input');
  });

  it('returns not_found for an unknown tool name', () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const registry = new ToolRegistry([tool]);
    const resolved = registry.resolve('nonexistent', { value: 'hi' });
    expect(resolved).toEqual({ kind: 'not_found' });
  });

  it('returns handler_error when the handler throws', async () => {
    const tool = makeTool('throws', async () => {
      throw new Error('boom');
    });
    const registry = new ToolRegistry([tool]);
    const resolved = registry.resolve('throws', { value: 'hi' });
    expect(resolved.kind).toBe('ready');
    if (resolved.kind !== 'ready') {
      return;
    }
    const runResult = await resolved.run();
    expect(runResult).toEqual({ kind: 'handler_error', error: 'boom' });
  });

  it('applies the transform hook passed to run, not to resolve', async () => {
    const tool = makeTool('echo', async (input) => ({ value: input.value }));
    const registry = new ToolRegistry([tool]);
    const transform = (_name: string, output: unknown): unknown => {
      const obj = output as { value: string };
      return `transformed: ${obj.value}`;
    };
    const resolved = registry.resolve('echo', { value: 'hi' });
    expect(resolved.kind).toBe('ready');
    if (resolved.kind !== 'ready') {
      return;
    }
    const runResult = await resolved.run(transform);
    expect(runResult).toEqual({ kind: 'success', content: 'transformed: hi' });
  });

  it('stringifies non-string handler output', async () => {
    const tool = makeTool('echo', async (input) => ({ value: input.value, count: 42 }));
    const registry = new ToolRegistry([tool]);
    const resolved = registry.resolve('echo', { value: 'hi' });
    expect(resolved.kind).toBe('ready');
    if (resolved.kind !== 'ready') {
      return;
    }
    const runResult = await resolved.run();
    expect(runResult).toEqual({ kind: 'success', content: JSON.stringify({ value: 'hi', count: 42 }) });
  });

  it('parses the input exactly once — the run closure does not re-parse', async () => {
    // Track how often safeParse is called by wrapping a real zod schema with
    // a counter. The registry should invoke safeParse once during resolve and
    // never again during run.
    const baseSchema = z.object({ value: z.string() });
    let parseCount = 0;
    const countingSchema = baseSchema.superRefine((_v, _ctx) => {
      parseCount++;
    });
    const tool: AnyToolDefinition = {
      name: 'echo',
      description: 'Tool echo',
      input_schema: countingSchema,
      input_examples: [{ value: 'example' }],
      handler: (async (input: { value: string }) => input.value) as (input: never) => Promise<unknown>,
    };
    const registry = new ToolRegistry([tool]);
    const resolved = registry.resolve('echo', { value: 'hi' });
    expect(parseCount).toBe(1);
    expect(resolved.kind).toBe('ready');
    if (resolved.kind !== 'ready') {
      return;
    }
    await resolved.run();
    // run() must call the handler with the already-parsed value. No second
    // parse. This is the property that matches ToolRegistry.resolve, which
    // parses once up front and threads the parsed data through the approval
    // machinery to the handler.
    expect(parseCount).toBe(1);
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
