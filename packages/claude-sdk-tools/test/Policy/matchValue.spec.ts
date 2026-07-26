import { describe, expect, it } from 'vitest';
import { matchesValue } from '../../src/Policy/matchValue.js';

describe('matchesValue - plain list, membership against a scalar', () => {
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

describe('matchesValue - allOf, every value must be present', () => {
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

describe('matchesValue - anyOf, at least one value must be present', () => {
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

describe('matchesValue - a plain list against an array actual value', () => {
  it('is equivalent to anyOf: matches when the actual array contains one of the listed values', () => {
    const expected = matchesValue({ anyOf: ['-f', '--force'] }, ['push', '--force']);
    const actual = matchesValue(['-f', '--force'], ['push', '--force']);
    expect(actual).toBe(expected);
  });

  it('is equivalent to anyOf: does not match when none of the listed values are present', () => {
    const expected = matchesValue({ anyOf: ['-f', '--force'] }, ['push']);
    const actual = matchesValue(['-f', '--force'], ['push']);
    expect(actual).toBe(expected);
  });
});

describe('matchesValue - allOf and anyOf combined in one pattern', () => {
  it('matches only when both hold: all of the required flags, and at least one of the risky ones', () => {
    const expected = true;
    const actual = matchesValue({ allOf: ['push'], anyOf: ['-f', '--force'] }, ['push', '--force']);
    expect(actual).toBe(expected);
  });

  it('does not match when allOf holds but anyOf does not', () => {
    const expected = false;
    const actual = matchesValue({ allOf: ['push'], anyOf: ['-f', '--force'] }, ['push', 'origin', 'main']);
    expect(actual).toBe(expected);
  });

  it('does not match when anyOf holds but allOf does not', () => {
    const expected = false;
    const actual = matchesValue({ allOf: ['push'], anyOf: ['-f', '--force'] }, ['pull', '--force']);
    expect(actual).toBe(expected);
  });
});

describe('matchesValue - allOf combined with suffix, a combination that can never hold', () => {
  it('never matches, because allOf needs an array and suffix needs a string on the same value', () => {
    const expected = false;
    const actual = matchesValue({ allOf: ['reset'], suffix: '.exe' }, ['reset', '--hard']);
    expect(actual).toBe(expected);
  });

  it('still never matches even when the actual value would satisfy suffix on its own', () => {
    const expected = false;
    const actual = matchesValue({ allOf: ['reset'], suffix: '.exe' }, 'malware.exe');
    expect(actual).toBe(expected);
  });
});

describe('matchesValue - anyOf combined with suffix, the same impossible combination', () => {
  it('never matches, for the same reason as allOf + suffix', () => {
    const expected = false;
    const actual = matchesValue({ anyOf: ['-f', '--force'], suffix: '.exe' }, ['push', '--force']);
    expect(actual).toBe(expected);
  });
});

describe('matchesValue - allOf/anyOf normalise CLI flag conventions, same as ruleConfigMatches', () => {
  it('matches --foo=bar against allOf: [\'--foo\'], the value is never matched on', () => {
    const expected = true;
    const actual = matchesValue({ allOf: ['--foo'] }, ['--foo=bar']);
    expect(actual).toBe(expected);
  });

  it('matches a bundled short flag -ni against anyOf: [\'-i\']', () => {
    const expected = true;
    const actual = matchesValue({ anyOf: ['-i'] }, ['-ni']);
    expect(actual).toBe(expected);
  });

  it('still matches the literal bundled token itself, not only its exploded form', () => {
    const expected = true;
    const actual = matchesValue({ anyOf: ['-ni'] }, ['-ni']);
    expect(actual).toBe(expected);
  });
});

describe('matchesValue - maxLength, an array must not exceed this many items', () => {
  it('matches when the actual array is within the limit', () => {
    const expected = true;
    const actual = matchesValue({ maxLength: 0 }, []);
    expect(actual).toBe(expected);
  });

  it('does not match when the actual array exceeds the limit', () => {
    const expected = false;
    const actual = matchesValue({ maxLength: 0 }, ['FOO=bar']);
    expect(actual).toBe(expected);
  });

  it('does not match a scalar actual value at all, maxLength only applies to arrays', () => {
    const expected = false;
    const actual = matchesValue({ maxLength: 5 }, 'not-an-array');
    expect(actual).toBe(expected);
  });
});

describe('matchesValue - basename, strips any path prefix before comparing', () => {
  it('matches an absolute path by its basename', () => {
    const expected = true;
    const actual = matchesValue({ basename: ['rm'] }, '/bin/rm');
    expect(actual).toBe(expected);
  });

  it('matches a relative path by its basename', () => {
    const expected = true;
    const actual = matchesValue({ basename: ['rm'] }, './rm');
    expect(actual).toBe(expected);
  });

  it('still matches a bare name with no path at all', () => {
    const expected = true;
    const actual = matchesValue({ basename: ['rm'] }, 'rm');
    expect(actual).toBe(expected);
  });

  it('does not match a name that merely ends with the target, not equals it', () => {
    const expected = false;
    const actual = matchesValue({ basename: ['rm'] }, '/bin/xrm');
    expect(actual).toBe(expected);
  });

  it('does not match a different program at a similar path', () => {
    const expected = false;
    const actual = matchesValue({ basename: ['rm'] }, '/bin/pnpm');
    expect(actual).toBe(expected);
  });

  it('scopes the transform to the field that opted in — does not affect a path field elsewhere in the same rule', () => {
    // Not this module's concern to prove in isolation (resolve.spec.ts / policy.integration.spec.ts
    // cover multi-field rules); this only confirms basename itself never runs unless asked.
    const expected = false;
    const actual = matchesValue(['rm'], '/bin/rm');
    expect(actual).toBe(expected);
  });
});

describe('matchesValue - suffix', () => {
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
