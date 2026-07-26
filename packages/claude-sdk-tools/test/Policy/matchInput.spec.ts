import { describe, expect, it } from 'vitest';
import { matchesInput } from '../../src/Policy/matchInput.js';

describe('matchesInput', () => {
  it('matches the real input.program field directly, by name', () => {
    const expected = true;
    const actual = matchesInput({ program: ['rm'] }, { program: 'rm', args: ['-rf', '/tmp'] });
    expect(actual).toBe(expected);
  });

  it('does not match a different program', () => {
    const expected = false;
    const actual = matchesInput({ program: ['rm'] }, { program: 'pnpm', args: ['build'] });
    expect(actual).toBe(expected);
  });

  it('matches multiple fields at once, all of which must hold', () => {
    const expected = true;
    const actual = matchesInput({ program: ['git'], args: { allOf: ['reset'] } }, { program: 'git', args: ['reset', '--hard'] });
    expect(actual).toBe(expected);
  });

  it('fails when only one of several named fields matches', () => {
    const expected = false;
    const actual = matchesInput({ program: ['git'], args: { allOf: ['reset'] } }, { program: 'git', args: ['status'] });
    expect(actual).toBe(expected);
  });

  it('never matches when the named field is absent from the real input entirely', () => {
    const expected = false;
    const actual = matchesInput({ program: ['rm'] }, { path: '/some/file' });
    expect(actual).toBe(expected);
  });

  it('matches everything when the rule has no input matcher', () => {
    const expected = true;
    const actual = matchesInput(undefined, { path: '/some/file' });
    expect(actual).toBe(expected);
  });
});
