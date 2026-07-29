import { describe, expect, it } from 'vitest';
import { matchesPath } from '../../src/Policy/matchPath.js';

const cwd = '/repo';
const home = '/home/stephen';

function matches(pattern: string, path: string): boolean {
  return matchesPath(pattern, path, cwd, home);
}

// ---------------------------------------------------------------------------
// A single `*` stays inside one path segment. This is the conventional split
// (shell, .gitignore, minimatch) and the reason `$PWD/*.env` must not reach a
// nested file: a rule written for the project root should not silently govern
// everything beneath it.
// ---------------------------------------------------------------------------

describe('matchesPath — a single * matches within one segment', () => {
  it('matches a file directly inside the base', () => {
    expect(matches('$PWD/*.env', '/repo/a.env')).toBe(true);
  });

  it('matches a dotfile, since a leading dot is not special here', () => {
    expect(matches('$PWD/*.env', '/repo/.env')).toBe(true);
  });

  it('does not cross a slash into a nested directory', () => {
    expect(matches('$PWD/*.env', '/repo/src/a.env')).toBe(false);
  });

  it('matches any single entry when the whole segment is *', () => {
    expect(matches('$PWD/*', '/repo/a.txt')).toBe(true);
  });

  it('does not match a nested entry when the whole segment is *', () => {
    expect(matches('$PWD/*', '/repo/src/a.txt')).toBe(false);
  });

  it('matches in the middle of a pattern', () => {
    expect(matches('$PWD/*/a.ts', '/repo/src/a.ts')).toBe(true);
  });

  it('requires the starred segment to exist', () => {
    expect(matches('$PWD/*/a.ts', '/repo/a.ts')).toBe(false);
  });

  it('treats a regex metacharacter in a literal segment as a literal', () => {
    expect(matches('$PWD/*.env', '/repo/axenv')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// `**` spans any number of segments, including none. The zero-segment case is
// the one implementations get wrong, and it is the difference between
// `$PWD/**/*.env` protecting the project's own .env or only nested ones.
// ---------------------------------------------------------------------------

describe('matchesPath — ** spans any number of segments', () => {
  it('matches at the base, with no intervening segment at all', () => {
    expect(matches('$PWD/**/*.env', '/repo/.env')).toBe(true);
  });

  it('matches one level down', () => {
    expect(matches('$PWD/**/*.env', '/repo/src/.env')).toBe(true);
  });

  it('matches several levels down', () => {
    expect(matches('$PWD/**/*.env', '/repo/a/b/c/.env')).toBe(true);
  });

  it('matches a named file at any depth', () => {
    expect(matches('$PWD/**/world', '/repo/a/b/world')).toBe(true);
  });

  it('still requires the literal after it to match', () => {
    expect(matches('$PWD/**/world', '/repo/a/b/worldly')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A trailing /** is the form that already existed, and its meaning must not
// change: the base itself and everything beneath it.
// ---------------------------------------------------------------------------

describe('matchesPath — a trailing /** covers the base and everything under it', () => {
  it('matches the base directory itself', () => {
    expect(matches('$PWD/**', '/repo')).toBe(true);
  });

  it('matches a direct child', () => {
    expect(matches('$PWD/**', '/repo/a.txt')).toBe(true);
  });

  it('matches a deeply nested child', () => {
    expect(matches('$PWD/**', '/repo/a/b/c.txt')).toBe(true);
  });

  it('does not match a sibling that merely shares the prefix', () => {
    expect(matches('$PWD/**', '/repo-other/a.txt')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Combinations, including the shapes that look nonsensical but are lawful.
// ---------------------------------------------------------------------------

describe('matchesPath — combined and redundant patterns', () => {
  it('collapses consecutive ** rather than rejecting them', () => {
    expect(matches('$PWD/*/**/**', '/repo/a/b/c')).toBe(true);
  });

  it('still honours the leading * when ** follows it', () => {
    expect(matches('$PWD/*/**/**', '/repo')).toBe(false);
  });

  it('matches a literal-then-any-depth-then-literal pattern', () => {
    expect(matches('$PWD/*/hello/**/world/**', '/repo/x/hello/a/b/world/c')).toBe(true);
  });

  it('matches that pattern with nothing between the two literals', () => {
    expect(matches('$PWD/*/hello/**/world/**', '/repo/x/hello/world')).toBe(true);
  });

  it('does not match when a literal in the middle is absent', () => {
    expect(matches('$PWD/*/hello/**/world/**', '/repo/x/goodbye/world')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// `**` with more structure after it. A prefix-based matcher can express "any
// depth" only at the end; here the pattern has to resume matching exact shape
// once the ** has absorbed however many segments it needs.
// ---------------------------------------------------------------------------

describe('matchesPath — ** in the middle, with segments still to match after it', () => {
  const pattern = '$PWD/*/hello/**/world/*/*.txt';

  it('matches with the ** absorbing nothing', () => {
    expect(matches(pattern, '/repo/x/hello/world/sub/a.txt')).toBe(true);
  });

  it('matches with the ** absorbing several segments', () => {
    expect(matches(pattern, '/repo/x/hello/a/b/world/sub/a.txt')).toBe(true);
  });

  it('does not match when the single segment before the file is missing', () => {
    expect(matches(pattern, '/repo/x/hello/world/a.txt')).toBe(false);
  });

  it('does not match when the tail is nested deeper than the pattern allows', () => {
    expect(matches(pattern, '/repo/x/hello/world/sub/deep/a.txt')).toBe(false);
  });

  it('does not match a different extension', () => {
    expect(matches(pattern, '/repo/x/hello/world/sub/a.md')).toBe(false);
  });

  it('does not match when the leading single segment is absent', () => {
    expect(matches(pattern, '/repo/hello/world/sub/a.txt')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Everything the matcher did before globbing existed still holds.
// ---------------------------------------------------------------------------

describe('matchesPath — existing behaviour is unchanged', () => {
  it('the bare wildcard matches any path', () => {
    expect(matches('*', '/anywhere/at/all.txt')).toBe(true);
  });

  it('a bare $PWD matches inside the working directory', () => {
    expect(matches('$PWD', '/repo/src/a.ts')).toBe(true);
  });

  it('a bare $PWD does not match outside it', () => {
    expect(matches('$PWD', '/elsewhere/a.ts')).toBe(false);
  });

  it('~/ expands against the supplied home', () => {
    expect(matches('~/.ssh/**', `${home}/.ssh/id_ed25519`)).toBe(true);
  });

  it('$HOME and ~/ mean the same thing', () => {
    expect(matches('$HOME/.ssh/**', `${home}/.ssh/id_ed25519`)).toBe(true);
  });

  it('a relative candidate path is resolved against cwd before comparing', () => {
    expect(matches('$PWD', 'src/a.ts')).toBe(true);
  });

  it('a relative candidate that climbs out does not match', () => {
    expect(matches('$PWD', '../outside.txt')).toBe(false);
  });

  it('a glob pattern is also boundary-safe against a prefix sibling', () => {
    expect(matches('$PWD/*', '/repo-other/a.txt')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Several `**` separated by literals cannot be merged away, so the matcher has
// to stay bounded on input that nearly matches and then fails at the very end.
// A regex built from the same pattern degrades exponentially here: measured at
// 0.4ms for a 16-character segment, doubling every two characters. The walk is
// flat because each retry consumes one more segment and never reconsiders an
// earlier one.
// ---------------------------------------------------------------------------

describe('matchesPath — pathological input stays bounded', () => {
  it('answers a deep near-miss against several ** without hanging', () => {
    const deep = `/repo/${Array.from({ length: 40 }, (_, i) => `d${i}`).join('/')}/nope`;

    const started = performance.now();
    const actual = matches('$PWD/**/a/**/b/**/c/**/d/**/e', deep);
    const elapsed = performance.now() - started;

    expect(actual).toBe(false);
    expect(elapsed).toBeLessThan(100);
  });

  it('answers a long single-segment near-miss against several * without hanging', () => {
    const segment = `${'a'.repeat(200)}b`;

    const started = performance.now();
    const actual = matches('$PWD/*a*a*a*a*a*a*a*c', `/repo/${segment}`);
    const elapsed = performance.now() - started;

    expect(actual).toBe(false);
    expect(elapsed).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// A run of slashes is one separator, and a trailing slash means nothing, the
// same way the kernel reads `/repo///src//a.ts` as `/repo/src/a.ts`. Neither
// side of a match can keep an empty segment, so a policy is never defeated by
// how someone happened to punctuate a path.
// ---------------------------------------------------------------------------

describe('matchesPath — slashes', () => {
  it('a trailing slash on a pattern changes nothing', () => {
    expect(matches('$PWD/', '/repo/src/a.ts')).toBe(true);
  });

  it('a trailing slash still does not reach outside the directory', () => {
    expect(matches('$PWD/', '/repo-other/a.ts')).toBe(false);
  });

  it('a trailing slash on a named subdirectory scopes the same as without one', () => {
    expect(matches('$PWD/src/', '/repo/src/a.ts')).toBe(true);
  });

  it('a run of slashes in a pattern is one separator', () => {
    expect(matches('$PWD//src', '/repo/src/a.ts')).toBe(true);
  });

  it('a run of slashes in the candidate path is one separator', () => {
    expect(matches('$PWD/src', '/repo///src//a.ts')).toBe(true);
  });

  it('a run of slashes on both sides still matches', () => {
    expect(matches('$PWD//src//', '/repo//src///a.ts')).toBe(true);
  });

  it('a run of slashes does not let a path escape a deny pattern', () => {
    expect(matches('~/.ssh/**', `${home}//.ssh///id_ed25519`)).toBe(true);
  });

  it('a run of slashes cannot stand in for a segment a pattern requires', () => {
    expect(matches('$PWD/src/*/a.ts', '/repo/src//a.ts')).toBe(false);
  });
});
