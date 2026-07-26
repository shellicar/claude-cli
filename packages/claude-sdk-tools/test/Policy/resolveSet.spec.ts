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
    const actual = resolveSet(
      targets.map((p) => resolve(policy, { tool: 'DeleteFile', input: {}, paths: [p], operation: 'fs.delete', cwd, home })),
    );
    expect(actual).toBe(expected);
  });

  it('allow is the loosest, and only wins when nothing stricter is present', () => {
    const expected = 'allow';
    const actual = resolveSet(['allow', 'allow']);
    expect(actual).toBe(expected);
  });

  it('an empty set resolves to ask, never a silent allow', () => {
    const expected = 'ask';
    const actual = resolveSet([]);
    expect(actual).toBe(expected);
  });
});
