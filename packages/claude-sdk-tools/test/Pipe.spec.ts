import type { AnyToolDefinition } from '@shellicar/claude-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Grep } from '../src/Grep/Grep';
import { Head } from '../src/Head/Head';
import { createPipe } from '../src/Pipe/Pipe';

describe('Pipe', () => {
  it('calls the single step tool and returns its result', async () => {
    const pipe = createPipe([Head as unknown as AnyToolDefinition]);
    const expected = { type: 'content', values: ['a', 'b'], totalLines: 3, path: undefined };
    const actual = await pipe.handler(
      {
        steps: [
          { tool: 'Head', input: { count: 2, content: { type: 'content', values: ['a', 'b', 'c'], totalLines: 3 } } },
        ],
      },
      new Map(),
    );
    expect(actual).toEqual(expected);
  });

  it('threads the output of one step into the content of the next', async () => {
    const pipe = createPipe([Head as unknown as AnyToolDefinition, Grep as unknown as AnyToolDefinition]);
    const expected = { type: 'content', values: ['a'], totalLines: 3, path: undefined };
    const actual = await pipe.handler(
      {
        steps: [
          { tool: 'Head', input: { count: 2, content: { type: 'content', values: ['a', 'b', 'c'], totalLines: 3 } } },
          { tool: 'Grep', input: { pattern: '^a$' } },
        ],
      },
      new Map(),
    );
    expect(actual).toEqual(expected);
  });

  it('throws when a tool name is not registered', async () => {
    const pipe = createPipe([]);
    const call = pipe.handler({ steps: [{ tool: 'Unknown', input: {} }] }, new Map());
    await expect(call).rejects.toThrow('Pipe: unknown tool "Unknown"');
  });

  it('throws when a write tool is used in a pipe', async () => {
    const writeTool: AnyToolDefinition = {
      name: 'WriteOp',
      description: 'A write operation',
      operation: 'write',
      input_schema: z.object({}),
      input_examples: [],
      handler: async () => 'done',
    };
    const pipe = createPipe([writeTool]);
    const call = pipe.handler({ steps: [{ tool: 'WriteOp', input: {} }] }, new Map());
    await expect(call).rejects.toThrow('only read tools may be used in a pipe');
  });

  it('throws when a step input fails schema validation', async () => {
    const strictTool: AnyToolDefinition = {
      name: 'StrictTool',
      description: 'Requires specific input',
      operation: 'read',
      input_schema: z.object({ required: z.string() }),
      input_examples: [],
      handler: async () => 'done',
    };
    const pipe = createPipe([strictTool]);
    const call = pipe.handler({ steps: [{ tool: 'StrictTool', input: {} }] }, new Map());
    await expect(call).rejects.toThrow('Pipe: step "StrictTool" input validation failed');
  });
});
