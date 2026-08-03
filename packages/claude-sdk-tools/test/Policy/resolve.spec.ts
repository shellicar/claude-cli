import { describe, expect, it } from 'vitest';
import { resolve } from '../../src/Policy/resolve.js';
import type { PolicySet } from '../../src/Policy/types.js';

const cwd = '/repo';
const home = '/home/stephen';

function check(policy: PolicySet, args: { tool: string; input?: unknown; paths?: string[]; operation: string }) {
  return resolve(policy, { tool: args.tool, input: args.input ?? {}, paths: args.paths ?? [], operation: args.operation, cwd, home, platform: 'linux' });
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

  it('a rule silent on this operation — no operations entry for it, no default — falls through to the next matching rule', () => {
    const policy: PolicySet = [
      { tool: 'Program', operations: { 'fs.read': 'allow' } },
      { tool: '*', default: 'deny' },
    ];
    const expected = 'deny';
    const actual = check(policy, { tool: 'Program', operation: 'fs.exec' }).verdict;
    expect(actual).toBe(expected);
  });

  it('a rule that does cover this operation still governs, without falling through', () => {
    const policy: PolicySet = [
      { tool: 'Program', operations: { 'fs.read': 'allow', 'fs.exec': 'allow' } },
      { tool: '*', default: 'deny' },
    ];
    const expected = 'allow';
    const actual = check(policy, { tool: 'Program', operation: 'fs.exec' }).verdict;
    expect(actual).toBe(expected);
  });

  it('a rule silent on every operation (no operations map, no default) falls through entirely', () => {
    const policy: PolicySet = [
      { tool: 'Program', message: 'informational only' },
      { tool: '*', default: 'allow' },
    ];
    const expected = 'allow';
    const actual = check(policy, { tool: 'Program', operation: 'fs.exec' }).verdict;
    expect(actual).toBe(expected);
  });

  it('falling through all the way with no rule covering the operation still asks, never silently allows', () => {
    const policy: PolicySet = [{ tool: 'Program', operations: { 'fs.read': 'allow' } }];
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

  it('a real (non-wildcard) path rule never matches a tool call with no resolved paths at all', () => {
    const policy: PolicySet = [
      { path: '$PWD', default: 'deny' },
      { tool: '*', default: 'allow' },
    ];
    const expected = 'allow';
    const actual = check(policy, { tool: 'Program', paths: [], operation: 'fs.exec' }).verdict;
    expect(actual).toBe(expected);
  });

  it('the wildcard path rule matches even with no resolved paths at all, since it imposes no real constraint', () => {
    const policy: PolicySet = [
      { path: '*', default: 'deny' },
      { tool: '*', default: 'allow' },
    ];
    const expected = 'deny';
    const actual = check(policy, { tool: 'Program', paths: [], operation: 'fs.exec' }).verdict;
    expect(actual).toBe(expected);
  });

  it('the wildcard path rule still matches normally when there are real paths too', () => {
    const policy: PolicySet = [
      { path: '*', default: 'deny' },
      { tool: '*', default: 'allow' },
    ];
    const expected = 'deny';
    const actual = check(policy, { tool: 'Find', paths: ['/anywhere/at/all.txt'], operation: 'fs.read' }).verdict;
    expect(actual).toBe(expected);
  });
});

// A call naming several paths is several calls: the operation is one indivisible act over all
// of them, so it is approved only to the extent every one of them is. Each path resolves on its
// own (tool AND input AND that path, first match wins) and the call takes the conjunction: any
// deny denies, else any ask asks, else allow.
describe('resolve — a call carrying several paths', () => {
  const zones: PolicySet = [
    { path: '~/.ssh/**', default: 'deny' },
    { path: '$PWD', operations: { 'fs.read': 'allow', 'fs.delete': 'ask' } },
    { path: '*', operations: { 'fs.read': 'allow', 'fs.delete': 'deny' } },
  ];

  it('denies the whole call when one path is denied and the other is allowed', () => {
    const expected = 'deny';
    const actual = check(zones, { tool: 'Read', paths: [`${home}/.ssh/id_ed25519`, `${cwd}/README.md`], operation: 'fs.read' }).verdict;
    expect(actual).toBe(expected);
  });

  it('is unaffected by the order the paths happen to arrive in', () => {
    const expected = 'deny';
    const actual = check(zones, { tool: 'Read', paths: [`${cwd}/README.md`, `${home}/.ssh/id_ed25519`], operation: 'fs.read' }).verdict;
    expect(actual).toBe(expected);
  });

  it('denies the whole call when one path asks and the other denies', () => {
    const expected = 'deny';
    const actual = check(zones, { tool: 'Delete', paths: [`${cwd}/a.txt`, '/tmp/b.txt'], operation: 'fs.delete' }).verdict;
    expect(actual).toBe(expected);
  });

  it('asks for the whole call when one path asks and the other allows', () => {
    const asksInside: PolicySet = [
      { path: '$PWD', operations: { 'fs.read': 'ask' } },
      { path: '*', operations: { 'fs.read': 'allow' } },
    ];
    const expected = 'ask';
    const actual = check(asksInside, { tool: 'Read', paths: [`${cwd}/a.txt`, '/tmp/b.txt'], operation: 'fs.read' }).verdict;
    expect(actual).toBe(expected);
  });

  it('allows the whole call only when every path allows', () => {
    const expected = 'allow';
    const actual = check(zones, { tool: 'Read', paths: [`${cwd}/a.txt`, '/tmp/b.txt'], operation: 'fs.read' }).verdict;
    expect(actual).toBe(expected);
  });

  it('reports the message belonging to the path that decided the call', () => {
    const withMessage: PolicySet = [
      { path: '~/.ssh/**', default: 'deny', message: 'ssh keys are off limits' },
      { path: '*', operations: { 'fs.read': 'allow' } },
    ];
    const expected = 'ssh keys are off limits';
    const actual = check(withMessage, { tool: 'Read', paths: [`${cwd}/README.md`, `${home}/.ssh/id_ed25519`], operation: 'fs.read' }).message;
    expect(actual).toBe(expected);
  });
});

describe('resolve — tool, input, and path all specified on one rule', () => {
  it('matches only when all three hold at once', () => {
    const policy: PolicySet = [{ tool: 'Program', input: { program: ['rm'] }, path: '$PWD', default: 'deny' }];

    const expected = 'deny';
    const actual = check(policy, { tool: 'Program', input: { program: 'rm', args: [] }, paths: [cwd], operation: 'fs.exec' }).verdict;
    expect(actual).toBe(expected);
  });

  it('does not match when the tool is right but the input is wrong', () => {
    const policy: PolicySet = [
      { tool: 'Program', input: { program: ['rm'] }, path: '$PWD', default: 'deny' },
      { tool: '*', default: 'allow' },
    ];

    const expected = 'allow';
    const actual = check(policy, { tool: 'Program', input: { program: 'pnpm', args: [] }, paths: [cwd], operation: 'fs.exec' }).verdict;
    expect(actual).toBe(expected);
  });

  it('does not match when the tool and input are right but the path is wrong', () => {
    const policy: PolicySet = [
      { tool: 'Program', input: { program: ['rm'] }, path: '$PWD', default: 'deny' },
      { tool: '*', default: 'allow' },
    ];

    const expected = 'allow';
    const actual = check(policy, { tool: 'Program', input: { program: 'rm', args: [] }, paths: ['/somewhere/else'], operation: 'fs.exec' }).verdict;
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

  it('leaves a placeholder literally in place when the named key is absent from the input', () => {
    const policy: PolicySet = [{ tool: '*', default: 'deny', message: 'blocked: {program}' }];

    const expected = 'blocked: {program}';
    const actual = check(policy, { tool: 'Find', operation: 'fs.read' }).message;
    expect(actual).toBe(expected);
  });

  it('substitutes more than one placeholder in the same message', () => {
    const policy: PolicySet = [{ tool: '*', default: 'deny', message: '{program} with {mode} is not allowed' }];

    const expected = 'rm with interactive is not allowed';
    const actual = check(policy, { tool: 'Program', input: { program: 'rm', mode: 'interactive' }, operation: 'fs.exec' }).message;
    expect(actual).toBe(expected);
  });
});
