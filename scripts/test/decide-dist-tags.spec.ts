import { describe, expect, it } from 'vitest';
import { decide } from '../src/decide-dist-tags.js';

// ---------------------------------------------------------------------------
// first publish (no current latest)
// ---------------------------------------------------------------------------

describe('decide — first publish (no current latest)', () => {
  it('stable first publish returns channel latest and setLatest true', () => {
    const expected = { channel: 'latest', setLatest: true };

    const actual = decide('1.0.0', null);

    expect(actual).toEqual(expected);
  });

  it('pre-release first publish returns pre-release channel and setLatest true', () => {
    const expected = { channel: 'beta', setLatest: true };

    const actual = decide('1.0.0-beta.1', null);

    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// latest decision — both stable
// ---------------------------------------------------------------------------

describe('decide — latest decision, both stable', () => {
  it('new higher stable version sets setLatest to true', () => {
    const expected = true;

    const actual = decide('1.1.0', '1.0.0').setLatest;

    expect(actual).toBe(expected);
  });

  it('new lower stable version sets setLatest to false', () => {
    const expected = false;

    const actual = decide('1.0.0', '1.1.0').setLatest;

    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// latest decision — both pre-release
// ---------------------------------------------------------------------------

describe('decide — latest decision, both pre-release', () => {
  it('new higher pre-release sets setLatest to true', () => {
    const expected = true;

    const actual = decide('1.0.0-beta.7', '1.0.0-beta.1').setLatest;

    expect(actual).toBe(expected);
  });

  it('new lower pre-release sets setLatest to false', () => {
    const expected = false;

    const actual = decide('1.0.0-beta.1', '1.0.0-beta.7').setLatest;

    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// latest decision — mixed
// ---------------------------------------------------------------------------

describe('decide — latest decision, mixed', () => {
  it('new stable beats current pre-release, setLatest is true', () => {
    const expected = true;

    const actual = decide('1.0.0', '1.0.0-beta.1').setLatest;

    expect(actual).toBe(expected);
  });

  it('new pre-release does not displace current stable, setLatest is false', () => {
    const expected = false;

    const actual = decide('1.0.0-beta.1', '1.0.0').setLatest;

    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// channel extraction
// ---------------------------------------------------------------------------

describe('decide — channel extraction', () => {
  it('known channel name extracted from pre-release identifier', () => {
    const expected = 'beta';

    const actual = decide('1.0.0-beta.7', null).channel;

    expect(actual).toBe(expected);
  });

  it('arbitrary channel name passes through unchanged', () => {
    const expected = 'whizzbang';

    const actual = decide('1.0.0-whizzbang.5', null).channel;

    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// rejections (must throw)
// ---------------------------------------------------------------------------

describe('decide — rejections', () => {
  it('multi-segment pre-release identifier throws', () => {
    const actual = () => decide('1.0.0-rc.foo.5', null);

    expect(actual).toThrow();
  });

  it('numeric-only first identifier throws', () => {
    const actual = () => decide('1.0.0-0', null);

    expect(actual).toThrow();
  });

  it('pre-release missing dot-number suffix throws', () => {
    const actual = () => decide('1.0.0-beta', null);

    expect(actual).toThrow();
  });

  it('non-numeric second identifier throws', () => {
    const actual = () => decide('1.0.0-beta.foo', null);

    expect(actual).toThrow();
  });

  it('reserved channel name throws', () => {
    const actual = () => decide('1.0.0-latest.5', null);

    expect(actual).toThrow();
  });

  it('invalid semver throws', () => {
    const actual = () => decide('not-a-version', null);

    expect(actual).toThrow();
  });
});
