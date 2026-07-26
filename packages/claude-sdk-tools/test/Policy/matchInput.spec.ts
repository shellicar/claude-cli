import { describe, expect, it } from 'vitest';
import { matchesInput } from '../../src/Policy/matchInput.js';

describe('matchesInput', () => {
  it('matches an already-extracted command against programs', () => {
    const expected = true;
    const actual = matchesInput({ programs: ['rm'] }, { program: 'rm', args: ['-rf', '/tmp'] });
    expect(actual).toBe(expected);
  });

  it('does not match a different program', () => {
    const expected = false;
    const actual = matchesInput({ programs: ['rm'] }, { program: 'pnpm', args: ['build'] });
    expect(actual).toBe(expected);
  });

  it('matches on argsAllOf the same way ruleConfig already does for git reset', () => {
    const expected = true;
    const actual = matchesInput({ programs: ['git'], argsAllOf: ['reset'] }, { program: 'git', args: ['reset', '--hard'] });
    expect(actual).toBe(expected);
  });

  it('never matches when the tool call has no extracted command at all', () => {
    const expected = false;
    const actual = matchesInput({ programs: ['rm'] }, undefined);
    expect(actual).toBe(expected);
  });

  it('matches everything when the rule has no input matcher', () => {
    const expected = true;
    const actual = matchesInput(undefined, undefined);
    expect(actual).toBe(expected);
  });
});
