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

  it('$PWD matches a relative path, resolved against cwd rather than compared as a raw string', () => {
    const expected = true;
    const actual = matchesPath('$PWD', '.tmp/delete1.txt', cwd, home);
    expect(actual).toBe(expected);
  });

  it('a relative path that climbs outside cwd does not match $PWD', () => {
    const expected = false;
    const actual = matchesPath('$PWD', '../outside.txt', cwd, home);
    expect(actual).toBe(expected);
  });
});

// $PWD and $HOME are exactly two fixed, special tokens — not a general environment-variable
// interpolation mechanism. Only these two are ever substituted; the pattern language doesn't
// grow by adding more env vars, it's these two constants or nothing.
describe('matchesPath — $HOME, the other special token, independent of $PWD', () => {
  it('$HOME matches a path inside the home directory even when $PWD is somewhere else entirely', () => {
    const expected = true;
    const actual = matchesPath('$HOME', `${home}/.zshrc`, cwd, home);
    expect(actual).toBe(expected);
  });

  it('$HOME does not match a path outside the home directory', () => {
    const expected = false;
    const actual = matchesPath('$HOME', '/tmp/other/file.txt', cwd, home);
    expect(actual).toBe(expected);
  });

  it('$HOME and ~/ resolve to the same thing', () => {
    const expected = matchesPath('~/.ssh/id_ed25519', `${home}/.ssh/id_ed25519`, cwd, home);
    const actual = matchesPath('$HOME/.ssh/id_ed25519', `${home}/.ssh/id_ed25519`, cwd, home);
    expect(actual).toBe(expected);
  });
});

describe('matchesPath — $PWD combined with a suffix, not just bare', () => {
  it('matches a path under a subdirectory of $PWD scoped by /**', () => {
    const expected = true;
    const actual = matchesPath('$PWD/secrets/**', `${cwd}/secrets/token.txt`, cwd, home);
    expect(actual).toBe(expected);
  });

  it('does not match a path under $PWD outside that specific subdirectory', () => {
    const expected = false;
    const actual = matchesPath('$PWD/secrets/**', `${cwd}/src/a.ts`, cwd, home);
    expect(actual).toBe(expected);
  });
});
