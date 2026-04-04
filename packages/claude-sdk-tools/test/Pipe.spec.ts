import type { AnyToolDefinition } from '@shellicar/claude-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Grep } from '../src/Grep/Grep';
import { Head } from '../src/Head/Head';
import { createPipe } from '../src/Pipe/Pipe';
import { Range } from '../src/Range/Range';
import { call } from './helpers';

/** Build a minimal read tool that passes its input straight through as its output. */
function passthrough(name: string, schema: z.ZodType = z.unknown()): AnyToolDefinition {
  return {
    name,
    description: name,
    operation: 'read',
    input_schema: schema,
    input_examples: [],
    handler: async (input) => input,
  };
}

describe('Pipe', () => {
  describe('basic chaining', () => {
    it('calls the single step tool and returns its result', async () => {
      const pipe = createPipe([Head as unknown as AnyToolDefinition]);
      const result = await call(pipe, {
        steps: [{ tool: 'Head', input: { count: 2, content: { type: 'content', values: ['a', 'b', 'c'], totalLines: 3 } } }],
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

    it('threads an empty intermediate result through the chain', async () => {
      // Grep that matches nothing → empty content → Range gets nothing
      const pipe = createPipe([Head as unknown as AnyToolDefinition, Grep as unknown as AnyToolDefinition, Range as unknown as AnyToolDefinition]);
      const result = await call(pipe, {
        steps: [
          { tool: 'Head', input: { count: 3, content: { type: 'content', values: ['a', 'b', 'c'], totalLines: 3 } } },
          { tool: 'Grep', input: { pattern: 'NOMATCH' } },
          { tool: 'Range', input: { start: 1, end: 5 } },
        ],
      });
      // Grep returns empty values; Range of an empty array is still empty
      expect(result).toMatchObject({ type: 'content', values: [] });
    });

    it('returns the last step result when chain has three steps', async () => {
      const pipe = createPipe([Head as unknown as AnyToolDefinition, Grep as unknown as AnyToolDefinition]);
      const result = await call(pipe, {
        steps: [
          { tool: 'Head', input: { count: 3, content: { type: 'content', values: ['foo', 'bar', 'baz'], totalLines: 3 } } },
          { tool: 'Grep', input: { pattern: 'ba' } },
        ],
      });
      expect(result).toMatchObject({ values: ['bar', 'baz'] });
    });
  });

  describe('store threading', () => {
    it('passes the same store instance to every step handler', async () => {
      const seenStores: Map<string, unknown>[] = [];
      const storeTool = (name: string): AnyToolDefinition => ({
        name,
        description: name,
        operation: 'read',
        input_schema: z.object({}).passthrough(),
        input_examples: [],
        handler: async (_input, store) => {
          seenStores.push(store);
          store.set(name, true);
          return { recorded: name };
        },
      });

      const pipe = createPipe([storeTool('A'), storeTool('B'), storeTool('C')]);
      await call(pipe, {
        steps: [
          { tool: 'A', input: {} },
          { tool: 'B', input: {} },
          { tool: 'C', input: {} },
        ],
      });

      // All three handlers received the same Map instance
      expect(seenStores).toHaveLength(3);
      expect(seenStores[0]).toBe(seenStores[1]);
      expect(seenStores[1]).toBe(seenStores[2]);
      // Each step's write is visible to subsequent steps
      expect(seenStores[2].get('A')).toBe(true);
      expect(seenStores[2].get('B')).toBe(true);
    });
  });

  describe('error handling', () => {
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

    it('propagates an exception thrown by a mid-chain handler', async () => {
      const boom: AnyToolDefinition = {
        name: 'Boom',
        description: 'Always throws',
        operation: 'read',
        input_schema: z.object({}).passthrough(),
        input_examples: [],
        handler: async () => {
          throw new Error('mid-chain boom');
        },
      };
      const after = passthrough('After');

      const pipe = createPipe([passthrough('Before'), boom, after]);
      const promise = call(pipe, {
        steps: [
          { tool: 'Before', input: {} },
          { tool: 'Boom', input: {} },
          { tool: 'After', input: {} },
        ],
      });
      await expect(promise).rejects.toThrow('mid-chain boom');
    });

    it('stops after a mid-chain handler throws — subsequent steps are not called', async () => {
      let afterCalled = false;
      const boom: AnyToolDefinition = {
        name: 'Boom',
        description: 'Always throws',
        operation: 'read',
        input_schema: z.object({}).passthrough(),
        input_examples: [],
        handler: async () => {
          throw new Error('abort');
        },
      };
      const after: AnyToolDefinition = {
        name: 'After',
        description: 'Should not run',
        operation: 'read',
        input_schema: z.object({}).passthrough(),
        input_examples: [],
        handler: async () => {
          afterCalled = true;
          return 'ran';
        },
      };

      const pipe = createPipe([passthrough('Before'), boom, after]);
      await expect(
        call(pipe, {
          steps: [
            { tool: 'Before', input: {} },
            { tool: 'Boom', input: {} },
            { tool: 'After', input: {} },
          ],
        }),
      ).rejects.toThrow('abort');

      expect(afterCalled).toBe(false);
    });
  });
});
