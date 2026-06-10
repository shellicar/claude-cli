import { describe, expect, it } from 'vitest';
import { parseConfigOverride } from '../src/cli-config/parseConfigOverride.js';

describe('parseConfigOverride', () => {
  it('returns the parsed object for a valid override', () => {
    const expected = { model: 'claude-opus-4-6' };
    const actual = parseConfigOverride('{"model":"claude-opus-4-6"}');
    expect(actual).toEqual(expected);
  });

  it('returns a partial nested override without injecting defaults', () => {
    const expected = { serverTools: { webSearch: { enabled: false } } };
    const actual = parseConfigOverride('{"serverTools":{"webSearch":{"enabled":false}}}');
    expect(actual).toEqual(expected);
  });

  it('returns an object with unknown keys unchanged (tolerated, validated later)', () => {
    const expected = { modl: 'typo' };
    const actual = parseConfigOverride('{"modl":"typo"}');
    expect(actual).toEqual(expected);
  });

  it('throws on malformed JSON', () => {
    const actual = () => parseConfigOverride('{not json}');
    expect(actual).toThrow();
  });

  it('throws on a string payload', () => {
    const actual = () => parseConfigOverride('"just a string"');
    expect(actual).toThrow();
  });

  it('throws on a number payload', () => {
    const actual = () => parseConfigOverride('42');
    expect(actual).toThrow();
  });

  it('throws on a JSON array', () => {
    const actual = () => parseConfigOverride('[]');
    expect(actual).toThrow();
  });
});
