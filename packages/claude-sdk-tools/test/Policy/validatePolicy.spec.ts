import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ToolLookup } from '../../src/Policy/validatePolicy.js';
import { validatePolicy } from '../../src/Policy/validatePolicy.js';

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

// `src/**` reads as "anywhere called src" and would behave as "this project's src". Neither the
// operator nor the engine can tell which was meant, so it is refused when the policy loads rather
// than silently picking one.
describe('validatePolicy — a path pattern that names nowhere in particular', () => {
  it('rejects a bare relative pattern', () => {
    const expected = false;
    const actual = validatePolicy([{ path: 'src/**', default: 'deny' }], { get: () => undefined }).valid;
    expect(actual).toBe(expected);
  });

  it('says how to write what was probably meant', () => {
    const result = validatePolicy([{ path: 'src/**', default: 'deny' }], { get: () => undefined });

    const expected = true;
    const actual = result.valid === false && result.errors.some((error) => error.includes('$PWD/src/**'));
    expect(actual).toBe(expected);
  });

  it('accepts a pattern that starts with a glob', () => {
    const expected = true;
    const actual = validatePolicy([{ path: '**', default: 'deny' }], { get: () => undefined }).valid;
    expect(actual).toBe(expected);
  });

  it('accepts a pattern anchored to the working directory', () => {
    const expected = true;
    const actual = validatePolicy([{ path: '$PWD/src/**', default: 'deny' }], { get: () => undefined }).valid;
    expect(actual).toBe(expected);
  });
});

// Only $PWD and $HOME are expanded, so any other variable in a pattern is text that matches
// nothing. Accepting it would put back the silent, covers-nothing rule the check exists to catch.
describe('validatePolicy — a path pattern naming a variable nothing expands', () => {
  it('rejects it', () => {
    const expected = false;
    const actual = validatePolicy([{ path: '$FOO/**', default: 'deny' }], { get: () => undefined }).valid;
    expect(actual).toBe(expected);
  });

  it('accepts $PWD and $HOME, which are expanded', () => {
    const expected = true;
    const actual = validatePolicy(
      [
        { path: '$PWD/**', default: 'deny' },
        { path: '$HOME/.ssh/**', default: 'deny' },
      ],
      { get: () => undefined },
    ).valid;
    expect(actual).toBe(expected);
  });
});
