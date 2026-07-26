import { describe, expect, it } from 'vitest';
import { matchesValue } from '../../src/Policy/matchValue.js';

describe('matchesValue \u2014 plain list, membership', () => {
  it('matches a scalar that is one of the listed values', () => {
    const expected = true;
    const actual = matchesValue(['rm', 'rmdir'], 'rm');
    expect(actual).toBe(expected);
  });

  it('does not match a scalar absent from the list', () => {
    const expected = false;
    const actual = matchesValue(['rm', 'rmdir'], 'pnpm');
    expect(actual).toBe(expected);
  });
});

describe('matchesValue \u2014 allOf, every value must be present', () => {
  it('matches when every listed value is present in the actual array', () => {
    const expected = true;
    const actual = matchesValue({ allOf: ['reset'] }, ['reset', '--hard']);
    expect(actual).toBe(expected);
  });

  it('does not match when one of the listed values is missing', () => {
    const expected = false;
    const actual = matchesValue({ allOf: ['reset', '--soft'] }, ['reset', '--hard']);
    expect(actual).toBe(expected);
  });
});

describe('matchesValue \u2014 anyOf, at least one value must be present', () => {
  it('matches when at least one listed value is present', () => {
    const expected = true;
    const actual = matchesValue({ anyOf: ['-f', '--force'] }, ['push', '--force']);
    expect(actual).toBe(expected);
  });

  it('does not match when none of the listed values are present', () => {
    const expected = false;
    const actual = matchesValue({ anyOf: ['-f', '--force'] }, ['push']);
    expect(actual).toBe(expected);
  });
});

describe('matchesValue \u2014 suffix', () => {
  it('matches a scalar ending with the given suffix', () => {
    const expected = true;
    const actual = matchesValue({ suffix: '.exe' }, 'malware.exe');
    expect(actual).toBe(expected);
  });

  it('does not match a scalar not ending with the given suffix', () => {
    const expected = false;
    const actual = matchesValue({ suffix: '.exe' }, 'pnpm');
    expect(actual).toBe(expected);
  });
});
