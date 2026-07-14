import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getDataDir } from '../src/entry/index.js';

describe('getDataDir', () => {
  const original = process.env.XDG_DATA_HOME;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = original;
    }
  });

  it('honours XDG_DATA_HOME when it is set', () => {
    process.env.XDG_DATA_HOME = '/tmp/xdg-data';
    const expected = join('/tmp/xdg-data', 'my-app');

    const actual = getDataDir('my-app');

    expect(actual).toBe(expected);
  });
});
