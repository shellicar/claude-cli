import { describe, expect, it } from 'vitest';
import { normaliseArg, normaliseArgs } from '../src/normaliseArgs.js';

describe('normaliseArg', () => {
  it('leaves a bare token untouched', () => {
    const expected = ['status'];
    const actual = normaliseArg('status');
    expect(actual).toEqual(expected);
  });

  it('strips the value off a long flag', () => {
    const expected = ['--foo'];
    const actual = normaliseArg('--foo=bar');
    expect(actual).toEqual(expected);
  });

  it('leaves a long flag with no value untouched', () => {
    const expected = ['--force'];
    const actual = normaliseArg('--force');
    expect(actual).toEqual(expected);
  });

  it('keeps the literal token and explodes a bundled short flag group', () => {
    const expected = ['-ni', '-n', '-i'];
    const actual = normaliseArg('-ni');
    expect(actual).toEqual(expected);
  });

  it('leaves a single-character short flag untouched, with no explosion', () => {
    const expected = ['-i'];
    const actual = normaliseArg('-i');
    expect(actual).toEqual(expected);
  });
});

describe('normaliseArgs', () => {
  it('flattens normalisation across every arg in order', () => {
    const expected = ['push', '--force', '-ni', '-n', '-i'];
    const actual = normaliseArgs(['push', '--force', '-ni']);
    expect(actual).toEqual(expected);
  });
});
