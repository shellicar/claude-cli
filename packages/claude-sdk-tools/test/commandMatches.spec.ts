import { describe, expect, it } from 'vitest';
import { commandMatches } from '../src/Exec/commandMatches';

describe('commandMatches', () => {
  it('matches when program and args are exactly equal', () => {
    const actual = commandMatches({ program: 'gh', args: ['pr', 'create'] }, { program: 'gh', args: ['pr', 'create'] });
    expect(actual).toBe(true);
  });

  it('does not match a different program', () => {
    const actual = commandMatches({ program: 'git', args: ['pr', 'create'] }, { program: 'gh', args: ['pr', 'create'] });
    expect(actual).toBe(false);
  });

  it('matches when the pattern args are a contiguous prefix with trailing extras', () => {
    const actual = commandMatches({ program: 'gh', args: ['pr', 'create', '--title', 'x'] }, { program: 'gh', args: ['pr', 'create'] });
    expect(actual).toBe(true);
  });

  it('matches when flags are interspersed between the pattern args', () => {
    const actual = commandMatches({ program: 'gh', args: ['--repo', 'r', 'pr', 'create'] }, { program: 'gh', args: ['pr', 'create'] });
    expect(actual).toBe(true);
  });

  it('does not match when the pattern args appear out of order', () => {
    const actual = commandMatches({ program: 'gh', args: ['create', 'pr'] }, { program: 'gh', args: ['pr', 'create'] });
    expect(actual).toBe(false);
  });

  it('does not match when a required arg is absent', () => {
    const actual = commandMatches({ program: 'gh', args: ['pr', 'list'] }, { program: 'gh', args: ['pr', 'create'] });
    expect(actual).toBe(false);
  });

  it('matches on program alone when the pattern has no args', () => {
    const actual = commandMatches({ program: 'gh', args: ['pr', 'view'] }, { program: 'gh', args: [] });
    expect(actual).toBe(true);
  });
});
