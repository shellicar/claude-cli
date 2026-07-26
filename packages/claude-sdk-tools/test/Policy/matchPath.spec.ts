import { describe, expect, it } from 'vitest';
import { matchesPath } from '../../src/Policy/matchPath.js';

const cwd = '/home/stephen/repos/proj';
const home = '/home/stephen';

describe('matchesPath', () => {
  it('the wildcard matches any path', () => {
    const expected = true;
    const actual = matchesPath('*', '/anywhere/at/all.txt', cwd, home);
    expect(actual).toBe(expected);
  });

  it('$PWD matches a path inside the working directory', () => {
    const expected = true;
    const actual = matchesPath('$PWD', `${cwd}/src/a.ts`, cwd, home);
    expect(actual).toBe(expected);
  });

  it('$PWD does not match a path outside the working directory', () => {
    const expected = false;
    const actual = matchesPath('$PWD', '/tmp/other/file.txt', cwd, home);
    expect(actual).toBe(expected);
  });

  it('a tilde pattern expands against the supplied home, not $PWD', () => {
    const expected = true;
    const actual = matchesPath('~/.ssh/**', `${home}/.ssh/id_ed25519`, cwd, home);
    expect(actual).toBe(expected);
  });

  it('a /** suffix matches any depth below the base', () => {
    const expected = true;
    const actual = matchesPath('~/.ssh/**', `${home}/.ssh/nested/deep/id_ed25519`, cwd, home);
    expect(actual).toBe(expected);
  });

  it('does not match a sibling path that merely shares a prefix string', () => {
    const expected = false;
    const actual = matchesPath('$PWD', `${cwd}-other/file.txt`, cwd, home);
    expect(actual).toBe(expected);
  });
});
