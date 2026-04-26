import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../src/private/ToolRegistry.js';
import type { AnyToolDefinition, ToolAttachmentBlock } from '../src/public/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(name: string, handler: (input: { value: string }) => Promise<unknown>): AnyToolDefinition {
  const schema = z.object({ value: z.string() });
  return {
    name,
    description: `Tool ${name}`,
    input_schema: schema,
    output_schema: z.unknown(),
    input_examples: [{ value: 'example' }],
    handler: (async (input: { value: string }) => ({
      textContent: await handler(input),
    })) as AnyToolDefinition['handler'],
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
      output_schema: z.unknown(),
      input_examples: [{ value: 'example' }],
      handler: (async (input: { value: string }) => ({ textContent: input.value })) as AnyToolDefinition['handler'],
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
  it('returns one entry per registered tool', () => {
    const tool1 = makeTool('echo', async (input) => input.value);
    const tool2 = makeTool('hello', async (input) => `hello ${input.value}`);
    const registry = new ToolRegistry([tool1, tool2]);
    expect(registry.wireTools).toHaveLength(2);
  });

  it('preserves the tool name on the wire representation', () => {
    const registry = new ToolRegistry([makeTool('echo', async (input) => input.value)]);
    expect(registry.wireTools[0]?.name).toBe('echo');
  });

  it('preserves the tool description on the wire representation', () => {
    const registry = new ToolRegistry([makeTool('echo', async (input) => input.value)]);
    expect(registry.wireTools[0]?.description).toBe('Tool echo');
  });

  it('converts the Zod schema to a JSON Schema input_schema', () => {
    const registry = new ToolRegistry([makeTool('echo', async (input) => input.value)]);
    expect(registry.wireTools[0]?.input_schema).toBeDefined();
  });

  it('returns the same cached array on repeated accesses', () => {
    const registry = new ToolRegistry([makeTool('echo', async (input) => input.value)]);
    const first = registry.wireTools;
    const second = registry.wireTools;
    expect(first[0]?.input_schema).toEqual(second[0]?.input_schema);
  });
});

describe('ToolRegistry — attachments', () => {
  it('content contains binary metadata when handler returns attachments', async () => {
    const block: ToolAttachmentBlock = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'base64data' },
    };
    const tool = makeTool('pdf', async () => 'ignored');
    tool.handler = async () => ({
      textContent: { type: 'binary', path: '/doc.pdf', mimeType: 'application/pdf', sizeKb: 10 },
      attachments: [block],
    });
    const registry = new ToolRegistry([tool]);
    const resolved = registry.resolve('pdf', { value: 'x' });
    if (resolved.kind !== 'ready') {
      throw new Error(`expected resolved.kind to be 'ready', got '${resolved.kind}'`);
    }
    const runResult = await resolved.run();
    if (runResult.kind !== 'success') {
      throw new Error(`expected runResult.kind to be 'success', got '${runResult.kind}'`);
    }

    const actual = runResult.content;
    const expected = '"type":"binary"';
    expect(actual).toContain(expected);
  });

  it('blocks has one entry when handler returns attachments', async () => {
    const block: ToolAttachmentBlock = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'base64data' },
    };
    const tool = makeTool('pdf', async () => 'ignored');
    tool.handler = async () => ({
      textContent: { type: 'binary', path: '/doc.pdf', mimeType: 'application/pdf', sizeKb: 10 },
      attachments: [block],
    });
    const registry = new ToolRegistry([tool]);
    const resolved = registry.resolve('pdf', { value: 'x' });
    if (resolved.kind !== 'ready') {
      throw new Error(`expected resolved.kind to be 'ready', got '${resolved.kind}'`);
    }
    const runResult = await resolved.run();
    if (runResult.kind !== 'success') {
      throw new Error(`expected runResult.kind to be 'success', got '${runResult.kind}'`);
    }

    const actual = runResult.blocks?.length;
    const expected = 1;
    expect(actual).toBe(expected);
  });

  it('block type is document when handler returns a document attachment', async () => {
    const block: ToolAttachmentBlock = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'base64data' },
    };
    const tool = makeTool('pdf', async () => 'ignored');
    tool.handler = async () => ({
      textContent: { type: 'binary', path: '/doc.pdf', mimeType: 'application/pdf', sizeKb: 10 },
      attachments: [block],
    });
    const registry = new ToolRegistry([tool]);
    const resolved = registry.resolve('pdf', { value: 'x' });
    if (resolved.kind !== 'ready') {
      throw new Error(`expected resolved.kind to be 'ready', got '${resolved.kind}'`);
    }
    const runResult = await resolved.run();
    if (runResult.kind !== 'success') {
      throw new Error(`expected runResult.kind to be 'success', got '${runResult.kind}'`);
    }

    const actual = runResult.blocks?.[0]?.type;
    const expected = 'document';
    expect(actual).toBe(expected);
  });

  it('block source type is base64 when handler returns a document attachment', async () => {
    const block: ToolAttachmentBlock = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'base64data' },
    };
    const tool = makeTool('pdf', async () => 'ignored');
    tool.handler = async () => ({
      textContent: { type: 'binary', path: '/doc.pdf', mimeType: 'application/pdf', sizeKb: 10 },
      attachments: [block],
    });
    const registry = new ToolRegistry([tool]);
    const resolved = registry.resolve('pdf', { value: 'x' });
    if (resolved.kind !== 'ready') {
      throw new Error(`expected resolved.kind to be 'ready', got '${resolved.kind}'`);
    }
    const runResult = await resolved.run();
    if (runResult.kind !== 'success') {
      throw new Error(`expected runResult.kind to be 'success', got '${runResult.kind}'`);
    }

    const actual = runResult.blocks?.[0]?.source?.type;
    const expected = 'base64';
    expect(actual).toBe(expected);
  });

  it('block source media_type is application/pdf when handler returns a document attachment', async () => {
    const block: ToolAttachmentBlock = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'base64data' },
    };
    const tool = makeTool('pdf', async () => 'ignored');
    tool.handler = async () => ({
      textContent: { type: 'binary', path: '/doc.pdf', mimeType: 'application/pdf', sizeKb: 10 },
      attachments: [block],
    });
    const registry = new ToolRegistry([tool]);
    const resolved = registry.resolve('pdf', { value: 'x' });
    if (resolved.kind !== 'ready') {
      throw new Error(`expected resolved.kind to be 'ready', got '${resolved.kind}'`);
    }
    const runResult = await resolved.run();
    if (runResult.kind !== 'success') {
      throw new Error(`expected runResult.kind to be 'success', got '${runResult.kind}'`);
    }

    const actual = runResult.blocks?.[0]?.source?.media_type;
    const expected = 'application/pdf';
    expect(actual).toBe(expected);
  });

  it('block source data matches when handler returns a document attachment', async () => {
    const block: ToolAttachmentBlock = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'base64data' },
    };
    const tool = makeTool('pdf', async () => 'ignored');
    tool.handler = async () => ({
      textContent: { type: 'binary', path: '/doc.pdf', mimeType: 'application/pdf', sizeKb: 10 },
      attachments: [block],
    });
    const registry = new ToolRegistry([tool]);
    const resolved = registry.resolve('pdf', { value: 'x' });
    if (resolved.kind !== 'ready') {
      throw new Error(`expected resolved.kind to be 'ready', got '${resolved.kind}'`);
    }
    const runResult = await resolved.run();
    if (runResult.kind !== 'success') {
      throw new Error(`expected runResult.kind to be 'success', got '${runResult.kind}'`);
    }

    const actual = runResult.blocks?.[0]?.source?.data;
    const expected = 'base64data';
    expect(actual).toBe(expected);
  });

  it('transform is called once when handler returns attachments', async () => {
    const seen: unknown[] = [];
    const transform = (_name: string, output: unknown) => {
      seen.push(output);
      return output;
    };
    const tool = makeTool('pdf', async () => 'ignored');
    tool.handler = async () => ({
      textContent: { type: 'binary', path: '/x.pdf', mimeType: 'application/pdf', sizeKb: 1 },
      attachments: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'bd' } }],
    });
    const registry = new ToolRegistry([tool]);
    const resolved = registry.resolve('pdf', { value: 'x' });
    if (resolved.kind !== 'ready') {
      throw new Error(`expected resolved.kind to be 'ready', got '${resolved.kind}'`);
    }
    await resolved.run(transform);

    const actual = seen.length;
    const expected = 1;
    expect(actual).toBe(expected);
  });

  it('transform receives the textContent value directly', async () => {
    const seen: unknown[] = [];
    const transform = (_name: string, output: unknown) => {
      seen.push(output);
      return output;
    };
    const expected = { type: 'binary', path: '/x.pdf', mimeType: 'application/pdf', sizeKb: 1 };
    const tool = makeTool('pdf', async () => 'ignored');
    tool.handler = async () => ({
      textContent: expected,
      attachments: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'bd' } }],
    });
    const registry = new ToolRegistry([tool]);
    const resolved = registry.resolve('pdf', { value: 'x' });
    if (resolved.kind !== 'ready') {
      throw new Error(`expected resolved.kind to be 'ready', got '${resolved.kind}'`);
    }
    await resolved.run(transform);

    const actual = seen[0];
    expect(actual).toBe(expected);
  });

  it('blocks key is absent when handler returns no attachments', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const registry = new ToolRegistry([tool]);
    const resolved = registry.resolve('echo', { value: 'hi' });
    if (resolved.kind !== 'ready') {
      throw new Error(`expected resolved.kind to be 'ready', got '${resolved.kind}'`);
    }
    const runResult = await resolved.run();
    if (runResult.kind !== 'success') {
      throw new Error(`expected runResult.kind to be 'success', got '${runResult.kind}'`);
    }

    const actual = 'blocks' in runResult;
    const expected = false;
    expect(actual).toBe(expected);
  });
});
