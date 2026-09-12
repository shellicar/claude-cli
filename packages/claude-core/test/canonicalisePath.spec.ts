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
    const fs = fsWith();
    const actual = canonicalisePath('src/file.ts', fs, fs);
    expect(actual).toBe(expected);
  });

  it('collapses dot segments', () => {
    const expected = '/project/src/file.ts';
    const fs = fsWith();
    const actual = canonicalisePath('src/nested/../file.ts', fs, fs);
    expect(actual).toBe(expected);
  });

  it('resolves a file that exists through the symlinked directories above it', () => {
    const expected = `${REAL_WORKSPACE}/existing.txt`;
    const fs = fsWith();
    const actual = canonicalisePath(`${WORKSPACE}/existing.txt`, fs, fs);
    expect(actual).toBe(expected);
  });

  it('resolves a file that does not exist yet through the symlinked directories above it', () => {
    const expected = `${REAL_WORKSPACE}/notes.md`;
    const fs = fsWith();
    const actual = canonicalisePath(`${WORKSPACE}/notes.md`, fs, fs);
    expect(actual).toBe(expected);
  });

  it('resolves a symlink to the file it points at', () => {
    const expected = '/private/tmp/target/real.txt';
    const fs = fsWith({ links: { [`${REAL_WORKSPACE}/live-link`]: '/tmp/target/real.txt' } });
    const actual = canonicalisePath(`${WORKSPACE}/live-link`, fs, fs);
    expect(actual).toBe(expected);
  });

  it('resolves a symlink whose target does not exist yet', () => {
    const expected = '/private/tmp/target/not-yet.txt';
    const fs = fsWith({ links: { [`${REAL_WORKSPACE}/dangling`]: '/tmp/target/not-yet.txt' } });
    const actual = canonicalisePath(`${WORKSPACE}/dangling`, fs, fs);
    expect(actual).toBe(expected);
  });

  it('resolves a file that does not exist yet under a symlinked directory', () => {
    const expected = '/private/tmp/target/brand-new.txt';
    const fs = fsWith({ links: { [`${REAL_WORKSPACE}/dir-link`]: '/tmp/target' } });
    const actual = canonicalisePath(`${WORKSPACE}/dir-link/brand-new.txt`, fs, fs);
    expect(actual).toBe(expected);
  });

  it('resolves a link written relative to the directory holding it', () => {
    const expected = `${REAL_TMP}/claude-501/conversation/sibling.txt`;
    const fs = fsWith({ links: { [`${REAL_WORKSPACE}/up-link`]: '../sibling.txt' } });
    const actual = canonicalisePath(`${WORKSPACE}/up-link`, fs, fs);
    expect(actual).toBe(expected);
  });

  it('follows a chain of links to where it finally points', () => {
    const links = { [`${REAL_WORKSPACE}/first`]: `${WORKSPACE}/second`, [`${REAL_WORKSPACE}/second`]: '/tmp/target/real.txt' };
    const expected = '/private/tmp/target/real.txt';
    const fs = fsWith({ links });
    const actual = canonicalisePath(`${WORKSPACE}/first`, fs, fs);
    expect(actual).toBe(expected);
  });

  // The bug this whole shape exists to prevent: a budget spent per path component runs out on a deep
  // tree and hands back a path nothing resolved, which the containment check then reads as a plain
  // string. Depth alone must never change the answer.
  it('resolves a file buried far deeper than any symlink traversal limit', () => {
    const deep = Array.from({ length: 60 }, (_, i) => `d${i}`).join('/');
    const expected = `${REAL_WORKSPACE}/${deep}/buried.txt`;
    const fs = fsWith({ entries: [`${REAL_WORKSPACE}/${deep}`] });
    const actual = canonicalisePath(`${WORKSPACE}/${deep}/buried.txt`, fs, fs);
    expect(actual).toBe(expected);
  });

  it('refuses a symlink loop rather than answering with the path it was given', () => {
    const links = { [`${REAL_WORKSPACE}/loop-a`]: `${WORKSPACE}/loop-b`, [`${REAL_WORKSPACE}/loop-b`]: `${WORKSPACE}/loop-a` };
    const fs = fsWith({ links });
    expect(() => canonicalisePath(`${WORKSPACE}/loop-a`, fs, fs)).toThrow();
  });

  it('leaves a path with nothing to resolve as its plain absolute form', () => {
    const expected = '/nowhere/at/all.txt';
    const fs = fsWith();
    const actual = canonicalisePath('/nowhere/at/all.txt', fs, fs);
    expect(actual).toBe(expected);
  });
});
