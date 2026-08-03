import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PolicyStore } from '../../src/Policy/PolicyStore.js';
import type { ToolLookup } from '../../src/Policy/validatePolicy.js';

const programModel = z.object({ program: z.string() });

function lookup(tools: Record<string, z.ZodType> = { Program: programModel }): ToolLookup {
  return { get: (name) => (tools[name] ? { model: tools[name] } : undefined) };
}

describe('PolicyStore \u2014 construction', () => {
  it('starts with the given policy when it is valid', () => {
    const initial = [{ tool: 'Program', default: 'deny' as const }];
    const store = new PolicyStore(initial, lookup());

    const expected = initial;
    const actual = store.current;
    expect(actual).toEqual(expected);
  });

  it('falls back to a safe ask-everything policy when the given initial policy is invalid, rather than starting with nothing', () => {
    const store = new PolicyStore([{ tool: 'Program', default: 'yolo' }], lookup());

    const resolved = store.current.length > 0;
    expect(resolved).toBe(true);
  });
});

describe('PolicyStore \u2014 update', () => {
  it('accepts a valid replacement policy', () => {
    const store = new PolicyStore([{ default: 'ask' as const }], lookup());
    const replacement = [{ tool: 'Program', default: 'deny' as const }];

    const result = store.update(replacement);

    expect(result.accepted).toBe(true);
    expect(store.current).toEqual(replacement);
  });

  it('rejects a case-1 invalid replacement, keeping the previous policy unchanged', () => {
    const previous = [{ tool: 'Program', default: 'deny' as const }];
    const store = new PolicyStore(previous, lookup());

    const result = store.update([{ tool: 'Program', default: 'yolo' }]);

    expect(result.accepted).toBe(false);
    expect(store.current).toEqual(previous);
  });

  it('reports the errors when a replacement is rejected', () => {
    const store = new PolicyStore([{ default: 'ask' as const }], lookup());

    const result = store.update([{ tool: 'Program', default: 'yolo' }]);

    const actual = !result.accepted && result.errors.length > 0;
    expect(actual).toBe(true);
  });

  it('rejects a case-2 invalid replacement, keeping the previous policy unchanged', () => {
    const previous = [{ tool: 'Program', default: 'deny' as const }];
    const store = new PolicyStore(previous, lookup());

    const result = store.update([{ tool: 'Program', input: { totallyMadeUp: ['x'] }, default: 'deny' as const }]);

    expect(result.accepted).toBe(false);
    expect(store.current).toEqual(previous);
  });

  it('accepts a case-3 replacement (an inert rule for an unloaded tool), and still surfaces the warning', () => {
    const store = new PolicyStore([{ default: 'ask' as const }], lookup());
    const replacement = [{ tool: 'Git_Reset', default: 'deny' as const }];

    const result = store.update(replacement);

    expect(result.accepted).toBe(true);
    expect(store.current).toEqual(replacement);
    expect(result.accepted && result.warnings.some((w) => w.includes('Git_Reset'))).toBe(true);
  });
});
