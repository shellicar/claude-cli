import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { validatePolicy } from '../../src/Policy/validatePolicy.js';
import type { ToolLookup } from '../../src/Policy/validatePolicy.js';

function lookup(tools: Record<string, z.ZodType>): ToolLookup {
  return { get: (name) => (tools[name] ? { model: tools[name] } : undefined) };
}

const programModel = z.object({ program: z.string(), args: z.array(z.string()).optional() });
const findModel = z.object({ path: z.string() });

describe('validatePolicy \u2014 case 1: wrong shape', () => {
  it('is invalid when a verdict is not one of allow/ask/deny', () => {
    const policy = [{ tool: 'Program', default: 'yolo' }];
    const registry = lookup({ Program: programModel });

    const result = validatePolicy(policy, registry);

    expect(result.valid).toBe(false);
  });

  it('names the broken field in the error', () => {
    const policy = [{ tool: 'Program', default: 'yolo' }];
    const registry = lookup({ Program: programModel });

    const result = validatePolicy(policy, registry);

    const actual = !result.valid && result.errors.some((e) => e.includes('default'));
    expect(actual).toBe(true);
  });

  it('collects every shape error, not just the first', () => {
    const policy = [
      { tool: 'Program', default: 'yolo' },
      { tool: 123, default: 'ask' },
    ];
    const registry = lookup({ Program: programModel });

    const result = validatePolicy(policy, registry);

    const expected = 2;
    const actual = !result.valid ? result.errors.length : 0;
    expect(actual).toBe(expected);
  });
});

describe('validatePolicy \u2014 case 2: a specific, loaded tool referencing a field it does not have', () => {
  it('is invalid when the field does not exist on the only named tool', () => {
    const policy = [{ tool: 'Program', input: { totallyMadeUp: ['x'] }, default: 'deny' }];
    const registry = lookup({ Program: programModel });

    const result = validatePolicy(policy, registry);

    expect(result.valid).toBe(false);
  });

  it('is valid when the field genuinely exists on the tool \u2014 no false positive', () => {
    const policy = [{ tool: 'Program', input: { program: ['rm'] }, default: 'deny' }];
    const registry = lookup({ Program: programModel });

    const result = validatePolicy(policy, registry);

    expect(result.valid).toBe(true);
  });

  it('is valid when at least one of several named tools has the field, even if another does not', () => {
    const policy = [{ tool: ['Program', 'Find'], input: { program: ['rm'] }, default: 'deny' }];
    const registry = lookup({ Program: programModel, Find: findModel });

    const result = validatePolicy(policy, registry);

    expect(result.valid).toBe(true);
  });

  it('a wildcard-scoped rule is never invalid this way, regardless of which tools have the field', () => {
    const policy = [{ tool: '*', input: { program: ['rm'] }, default: 'deny' }];
    const registry = lookup({ Find: findModel });

    const result = validatePolicy(policy, registry);

    expect(result.valid).toBe(true);
  });

  it('a rule with no tool scope at all is never invalid this way either', () => {
    const policy = [{ input: { program: ['rm'] }, default: 'deny' }];
    const registry = lookup({ Find: findModel });

    const result = validatePolicy(policy, registry);

    expect(result.valid).toBe(true);
  });
});

describe('validatePolicy \u2014 case 3: a rule scoped to a tool that is not currently loaded', () => {
  it('is still valid overall', () => {
    const policy = [{ tool: 'Git_Reset', input: { args: ['--hard'] }, default: 'deny' }];
    const registry = lookup({ Program: programModel });

    const result = validatePolicy(policy, registry);

    expect(result.valid).toBe(true);
  });

  it('carries a warning naming the unloaded tool', () => {
    const policy = [{ tool: 'Git_Reset', default: 'deny' }];
    const registry = lookup({ Program: programModel });

    const result = validatePolicy(policy, registry);

    const actual = result.valid && result.warnings.some((w) => w.includes('Git_Reset'));
    expect(actual).toBe(true);
  });

  it('does not warn about a tool that is actually registered', () => {
    const policy = [{ tool: 'Program', default: 'deny' }];
    const registry = lookup({ Program: programModel });

    const result = validatePolicy(policy, registry);

    const actual = result.valid ? result.warnings.length : -1;
    expect(actual).toBe(0);
  });
});

describe('validatePolicy \u2014 an empty policy', () => {
  it('is valid', () => {
    const result = validatePolicy([], lookup({}));
    expect(result.valid).toBe(true);
  });
});
