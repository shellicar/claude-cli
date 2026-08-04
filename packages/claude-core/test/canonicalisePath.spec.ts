import { describe, expect, it } from 'vitest';
import { canonicalisePath } from '../src/fs/canonicalisePath';
import { SymlinkFileSystem } from './SymlinkFileSystem';

// Mirrors the real shape on macOS, where the temp directory is itself reached through a symlink:
// /var is a link to /private/var, so nothing under it resolves to the path it was written as.
const CWD = '/project';
const TMP = '/var/folders/xk/T';
const REAL_TMP = '/private/var/folders/xk/T';
const WORKSPACE = `${TMP}/claude-501/conversation/scratchpad`;
const REAL_WORKSPACE = `${REAL_TMP}/claude-501/conversation/scratchpad`;

const baseEntries = [`${REAL_WORKSPACE}/existing.txt`, '/private/tmp/target/real.txt', '/project/src/file.ts'];
const baseLinks = { '/var': '/private/var', '/tmp': '/private/tmp' };

function fsWith(options: { entries?: string[]; links?: Record<string, string> } = {}): SymlinkFileSystem {
  return new SymlinkFileSystem({
    cwd: CWD,
    entries: [...baseEntries, ...(options.entries ?? [])],
    links: { ...baseLinks, ...(options.links ?? {}) },
  });
}

describe('canonicalisePath', () => {
  it('resolves a relative path against the working directory', () => {
    const expected = '/project/src/file.ts';
    const actual = canonicalisePath('src/file.ts', fsWith());
    expect(actual).toBe(expected);
  });

  it('collapses dot segments', () => {
    const expected = '/project/src/file.ts';
    const actual = canonicalisePath('src/nested/../file.ts', fsWith());
    expect(actual).toBe(expected);
  });

  it('resolves a file that exists through the symlinked directories above it', () => {
    const expected = `${REAL_WORKSPACE}/existing.txt`;
    const actual = canonicalisePath(`${WORKSPACE}/existing.txt`, fsWith());
    expect(actual).toBe(expected);
  });

  it('resolves a file that does not exist yet through the symlinked directories above it', () => {
    const expected = `${REAL_WORKSPACE}/notes.md`;
    const actual = canonicalisePath(`${WORKSPACE}/notes.md`, fsWith());
    expect(actual).toBe(expected);
  });

  it('resolves a symlink to the file it points at', () => {
    const expected = '/private/tmp/target/real.txt';
    const actual = canonicalisePath(`${WORKSPACE}/live-link`, fsWith({ links: { [`${REAL_WORKSPACE}/live-link`]: '/tmp/target/real.txt' } }));
    expect(actual).toBe(expected);
  });

  it('resolves a symlink whose target does not exist yet', () => {
    const expected = '/private/tmp/target/not-yet.txt';
    const actual = canonicalisePath(`${WORKSPACE}/dangling`, fsWith({ links: { [`${REAL_WORKSPACE}/dangling`]: '/tmp/target/not-yet.txt' } }));
    expect(actual).toBe(expected);
  });

  it('resolves a file that does not exist yet under a symlinked directory', () => {
    const expected = '/private/tmp/target/brand-new.txt';
    const actual = canonicalisePath(`${WORKSPACE}/dir-link/brand-new.txt`, fsWith({ links: { [`${REAL_WORKSPACE}/dir-link`]: '/tmp/target' } }));
    expect(actual).toBe(expected);
  });

  it('resolves a link written relative to the directory holding it', () => {
    const expected = `${REAL_TMP}/claude-501/conversation/sibling.txt`;
    const actual = canonicalisePath(`${WORKSPACE}/up-link`, fsWith({ links: { [`${REAL_WORKSPACE}/up-link`]: '../sibling.txt' } }));
    expect(actual).toBe(expected);
  });

  it('follows a chain of links to where it finally points', () => {
    const links = { [`${REAL_WORKSPACE}/first`]: `${WORKSPACE}/second`, [`${REAL_WORKSPACE}/second`]: '/tmp/target/real.txt' };
    const expected = '/private/tmp/target/real.txt';
    const actual = canonicalisePath(`${WORKSPACE}/first`, fsWith({ links }));
    expect(actual).toBe(expected);
  });

  // The bug this whole shape exists to prevent: a budget spent per path component runs out on a deep
  // tree and hands back a path nothing resolved, which the containment check then reads as a plain
  // string. Depth alone must never change the answer.
  it('resolves a file buried far deeper than any symlink traversal limit', () => {
    const deep = Array.from({ length: 60 }, (_, i) => `d${i}`).join('/');
    const expected = `${REAL_WORKSPACE}/${deep}/buried.txt`;
    const actual = canonicalisePath(`${WORKSPACE}/${deep}/buried.txt`, fsWith({ entries: [`${REAL_WORKSPACE}/${deep}`] }));
    expect(actual).toBe(expected);
  });

  it('refuses a symlink loop rather than answering with the path it was given', () => {
    const links = { [`${REAL_WORKSPACE}/loop-a`]: `${WORKSPACE}/loop-b`, [`${REAL_WORKSPACE}/loop-b`]: `${WORKSPACE}/loop-a` };
    expect(() => canonicalisePath(`${WORKSPACE}/loop-a`, fsWith({ links }))).toThrow();
  });

  it('leaves a path with nothing to resolve as its plain absolute form', () => {
    const expected = '/nowhere/at/all.txt';
    const actual = canonicalisePath('/nowhere/at/all.txt', fsWith());
    expect(actual).toBe(expected);
  });
});

// A caller whose paths are relative to somewhere other than the filesystem's own working directory
// passes that directory rather than resolving first, because expansion has to happen before
// resolution: `~/x` resolved by hand becomes a literal `~` component nothing can undo afterwards.
describe('canonicalisePath with a caller-supplied working directory', () => {
  it('resolves a relative path against the directory it was given', () => {
    const expected = '/private/var/folders/xk/T/claude-501/conversation/scratchpad/existing.txt';
    const actual = canonicalisePath('existing.txt', fsWith(), WORKSPACE);
    expect(actual).toBe(expected);
  });

  it('leaves an absolute path alone', () => {
    const expected = '/project/src/file.ts';
    const actual = canonicalisePath('/project/src/file.ts', fsWith(), WORKSPACE);
    expect(actual).toBe(expected);
  });

  it('expands the home directory before resolving, so it is never treated as a directory name', () => {
    const home = fsWith().homedir();
    const expected = canonicalisePath(`${home}/notes.txt`, fsWith());
    const actual = canonicalisePath('~/notes.txt', fsWith(), WORKSPACE);
    expect(actual).toBe(expected);
  });

  it('still defaults to the filesystem working directory when none is given', () => {
    const expected = '/project/src/file.ts';
    const actual = canonicalisePath('src/file.ts', fsWith());
    expect(actual).toBe(expected);
  });
});
