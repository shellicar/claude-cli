import type { AnyToolDefinition } from '@shellicar/claude-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Grep } from '../src/Grep/Grep';
import { Head } from '../src/Head/Head';
import { createPipe } from '../src/Pipe/Pipe';
import { call } from './helpers';

describe('Pipe', () => {
  it('calls the single step tool and returns its result', async () => {
    const pipe = createPipe([Head as unknown as AnyToolDefinition]);
    const result = await call(pipe, {
      steps: [
        { tool: 'Head', input: { count: 2, content: { type: 'content', values: ['a', 'b', 'c'], totalLines: 3 } } },
      ],
    });
    expect(result).toEqual({ type: 'content', values: ['a', 'b'], totalLines: 3, path: undefined });
  });

  it('threads the output of one step into the content of the next', async () => {
    const pipe = createPipe([Head as unknown as AnyToolDefinition, Grep as unknown as AnyToolDefinition]);
    const result = await call(pipe, {
      steps: [
        { tool: 'Head', input: { count: 2, content: { type: 'content', values: ['a', 'b', 'c'], totalLines: 3 } } },
        { tool: 'Grep', input: { pattern: '^a$' } },
      ],
    });
    expect(result).toEqual({ type: 'content', values: ['a'], totalLines: 3, path: undefined });
  });

  it('throws when a tool name is not registered', async () => {
    const pipe = createPipe([]);
    const promise = call(pipe, { steps: [{ tool: 'Unknown', input: {} }] });
    await expect(promise).rejects.toThrow('Pipe: unknown tool "Unknown"');
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
    const promise = call(pipe, { steps: [{ tool: 'WriteOp', input: {} }] });
    await expect(promise).rejects.toThrow('only read tools may be used in a pipe');
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
    const promise = call(pipe, { steps: [{ tool: 'StrictTool', input: {} }] });
    await expect(promise).rejects.toThrow('Pipe: step "StrictTool" input validation failed');
  });
});
