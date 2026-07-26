import { describe, expect, it } from 'vitest';
import { resolve } from '../../src/Policy/resolve.js';
import type { PolicySet } from '../../src/Policy/types.js';

const cwd = '/repo';
const home = '/home/stephen';

function check(policy: PolicySet, args: { tool: string; input?: unknown; paths?: string[]; operation: string }) {
  return resolve(policy, { tool: args.tool, input: args.input ?? {}, paths: args.paths ?? [], operation: args.operation, cwd, home });
}

describe('resolve — an unconfigured policy', () => {
  it('asks for everything, never silently allows', () => {
    const expected = 'ask';
    const actual = check([], { tool: 'Program', operation: 'fs.exec' }).verdict;
    expect(actual).toBe(expected);
  });
});

describe('resolve — first match wins', () => {
  it('an earlier matching rule governs even when a later rule would also match', () => {
    const policy: PolicySet = [
      { tool: 'Program', default: 'deny' },
      { tool: 'Program', default: 'allow' },
    ];
    const expected = 'deny';
    const actual = check(policy, { tool: 'Program', operation: 'fs.exec' }).verdict;
    expect(actual).toBe(expected);
  });

  it('a matched rule silent on this operation uses its own default, not a later more specific rule', () => {
    const policy: PolicySet = [
      { tool: 'Program', operations: { 'fs.read': 'allow' } },
      { tool: '*', default: 'deny' },
    ];
    const expected = 'ask';
    const actual = check(policy, { tool: 'Program', operation: 'fs.exec' }).verdict;
    expect(actual).toBe(expected);
  });
});

describe('resolve — operation-specific verdicts', () => {
  it('reads the named operation from the matched rule', () => {
    const policy: PolicySet = [{ tool: '*', operations: { 'fs.read': 'allow', 'fs.delete': 'deny' } }];
    const expected = 'deny';
    const actual = check(policy, { tool: 'DeleteFile', operation: 'fs.delete' }).verdict;
    expect(actual).toBe(expected);
  });
});

describe('resolve — input matching, against the real field names', () => {
  it('blocks a specific command by its input.program, leaving other Program calls untouched', () => {
    const policy: PolicySet = [
      { tool: 'Program', input: { program: ['rm'] }, default: 'deny' },
      { tool: '*', default: 'allow' },
    ];
    const denied = check(policy, { tool: 'Program', input: { program: 'rm', args: ['-rf'] }, operation: 'fs.exec' }).verdict;
    const allowed = check(policy, { tool: 'Program', input: { program: 'pnpm', args: ['build'] }, operation: 'fs.exec' }).verdict;
    expect(denied).toBe('deny');
    expect(allowed).toBe('allow');
  });
});

describe('resolve — path matching', () => {
  it('a carve-out ahead of the general rule wins over it', () => {
    const policy: PolicySet = [
      { path: '~/.ssh/**', default: 'deny' },
      { path: '*', default: 'allow' },
    ];
    const expected = 'deny';
    const actual = check(policy, { tool: 'Find', paths: [`${home}/.ssh/id_ed25519`], operation: 'fs.read' }).verdict;
    expect(actual).toBe(expected);
  });

  it('a path rule never matches a tool call with no resolved paths at all', () => {
    const policy: PolicySet = [
      { path: '*', default: 'deny' },
      { tool: '*', default: 'allow' },
    ];
    const expected = 'allow';
    const actual = check(policy, { tool: 'Program', paths: [], operation: 'fs.exec' }).verdict;
    expect(actual).toBe(expected);
  });
});

describe('resolve — the message shown to the model', () => {
  it('interpolates {program} from the real input.program field', () => {
    const policy: PolicySet = [{ tool: 'Program', input: { program: ['rm'] }, default: 'deny', message: '{program} is destructive and irreversible.' }];

    const expected = 'rm is destructive and irreversible.';
    const actual = check(policy, { tool: 'Program', input: { program: 'rm', args: ['-rf'] }, operation: 'fs.exec' }).message;
    expect(actual).toBe(expected);
  });

  it('carries no message when the matched rule sets none at all', () => {
    const policy: PolicySet = [{ tool: '*', default: 'allow' }];

    const expected = undefined;
    const actual = check(policy, { tool: 'Find', operation: 'fs.read' }).message;
    expect(actual).toBe(expected);
  });
});
