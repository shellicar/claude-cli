import { describe, expect, it } from 'vitest';
import { decide } from '../src/decide-dist-tags.js';

// ---------------------------------------------------------------------------
// first publish
// ---------------------------------------------------------------------------

describe('decide — first publish', () => {
  it('stable first publish returns channel latest', () => {
    const expected = { channel: 'latest' };

    const actual = decide('1.0.0');

    expect(actual).toEqual(expected);
  });

  it('pre-release first publish returns pre-release channel', () => {
    const expected = { channel: 'beta' };

    const actual = decide('1.0.0-beta.1');

    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// channel extraction
// ---------------------------------------------------------------------------

describe('decide — channel extraction', () => {
  it('known channel name extracted from pre-release identifier', () => {
    const expected = 'beta';

    const actual = decide('1.0.0-beta.7').channel;

    expect(actual).toBe(expected);
  });

  it('arbitrary channel name passes through unchanged', () => {
    const expected = 'whizzbang';

    const actual = decide('1.0.0-whizzbang.5').channel;

    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// rejections (must throw)
// ---------------------------------------------------------------------------

describe('decide — rejections', () => {
  it('multi-segment pre-release identifier throws', () => {
    const actual = () => decide('1.0.0-rc.foo.5');

    expect(actual).toThrow();
  });

  it('numeric-only first identifier throws', () => {
    const actual = () => decide('1.0.0-0');

    expect(actual).toThrow();
  });

  it('pre-release missing dot-number suffix throws', () => {
    const actual = () => decide('1.0.0-beta');

    expect(actual).toThrow();
  });

  it('non-numeric second identifier throws', () => {
    const actual = () => decide('1.0.0-beta.foo');

    expect(actual).toThrow();
  });

  it('reserved channel name throws', () => {
    const actual = () => decide('1.0.0-latest.5');

    expect(actual).toThrow();
  });

  it('invalid semver throws', () => {
    const actual = () => decide('not-a-version');

    expect(actual).toThrow();
  });
});
