import { describe, expect, it } from 'vitest';
import { resolve } from '../../src/Policy/resolve.js';
import { resolveSet } from '../../src/Policy/resolveSet.js';
import type { PolicySet } from '../../src/Policy/types.js';

const cwd = '/repo';
const home = '/home/stephen';

describe('resolveSet', () => {
  it('folds to the strictest verdict across several independently-resolved targets', () => {
    const policy: PolicySet = [
      { path: '$PWD', default: 'allow' },
      { path: '*', default: 'deny' },
    ];
    const targets = [`${cwd}/a.txt`, '/tmp/outside.txt'];

    const expected = 'deny';
    const actual = resolveSet(targets.map((p) => resolve(policy, { tool: 'DeleteFile', input: {}, paths: [p], operation: 'fs.delete', cwd, home }))).verdict;
    expect(actual).toBe(expected);
  });

  it('allow is the loosest, and only wins when nothing stricter is present', () => {
    const expected = 'allow';
    const actual = resolveSet([{ verdict: 'allow' }, { verdict: 'allow' }]).verdict;
    expect(actual).toBe(expected);
  });

  it('an empty set resolves to ask, never a silent allow', () => {
    const expected = 'ask';
    const actual = resolveSet([]).verdict;
    expect(actual).toBe(expected);
  });

  it('carries the message belonging to the strictest resolution, not an arbitrary one', () => {
    const expected = 'deny reason';
    const actual = resolveSet([{ verdict: 'allow' }, { verdict: 'deny', message: 'deny reason' }]).message;
    expect(actual).toBe(expected);
  });

  it('resolves to ask when every resolution is ask, with nothing stricter present', () => {
    const expected = 'ask';
    const actual = resolveSet([{ verdict: 'ask' }, { verdict: 'ask' }]).verdict;
    expect(actual).toBe(expected);
  });

  it('is stricter than allow, but not as strict as deny', () => {
    const expected = 'ask';
    const actual = resolveSet([{ verdict: 'allow' }, { verdict: 'ask' }]).verdict;
    expect(actual).toBe(expected);
  });

  it('when two resolutions tie on the strictest verdict, the earlier one in the list wins', () => {
    const expected = 'first';
    const actual = resolveSet([
      { verdict: 'deny', message: 'first' },
      { verdict: 'deny', message: 'second' },
    ]).message;
    expect(actual).toBe(expected);
  });
});
