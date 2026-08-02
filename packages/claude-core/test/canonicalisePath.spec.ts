import { describe, expect, it } from 'vitest';
import { canonicalisePath } from '../src/fs/canonicalisePath';
import { SymlinkFileSystem } from './SymlinkFileSystem';

const CWD = '/project';
const WORKSPACE = '/tmp/scratchpad';

function fsWith(links: Record<string, string> = {}): SymlinkFileSystem {
  return new SymlinkFileSystem({ cwd: CWD, links });
}

describe('canonicalisePath', () => {
  it('resolves a relative path against the working directory', () => {
    const expected = '/project/src/file.ts';
    const actual = canonicalisePath('src/file.ts', fsWith());
    expect(actual).toBe(expected);
  });

  it('collapses dot segments', () => {
    const expected = '/project/file.ts';
    const actual = canonicalisePath('src/../file.ts', fsWith());
    expect(actual).toBe(expected);
  });

  it('leaves a real path untouched', () => {
    const expected = `${WORKSPACE}/notes.md`;
    const actual = canonicalisePath(`${WORKSPACE}/notes.md`, fsWith());
    expect(actual).toBe(expected);
  });

  it('resolves a symlink to the file it points at', () => {
    const expected = '/etc/passwd';
    const actual = canonicalisePath(`${WORKSPACE}/escape`, fsWith({ [`${WORKSPACE}/escape`]: '/etc/passwd' }));
    expect(actual).toBe(expected);
  });

  it('resolves a file that does not exist yet through a symlinked parent', () => {
    const expected = '/etc/newfile';
    const actual = canonicalisePath(`${WORKSPACE}/escape/newfile`, fsWith({ [`${WORKSPACE}/escape`]: '/etc' }));
    expect(actual).toBe(expected);
  });

  it('resolves a symlinked directory several levels above the target', () => {
    const expected = '/etc/a/b/c.txt';
    const actual = canonicalisePath(`${WORKSPACE}/escape/a/b/c.txt`, fsWith({ [`${WORKSPACE}/escape`]: '/etc' }));
    expect(actual).toBe(expected);
  });

  it('leaves a path with no links anywhere in it as its plain absolute form', () => {
    const expected = '/nowhere/at/all.txt';
    const actual = canonicalisePath('/nowhere/at/all.txt', fsWith());
    expect(actual).toBe(expected);
  });

  it('resolves a symlink whose target does not exist yet', () => {
    const expected = '/elsewhere/pending.txt';
    const actual = canonicalisePath(`${WORKSPACE}/escape`, fsWith({ [`${WORKSPACE}/escape`]: '/elsewhere/pending.txt' }));
    expect(actual).toBe(expected);
  });

  it('follows a chain of links to where it finally points', () => {
    const expected = '/etc/passwd';
    const links = { [`${WORKSPACE}/first`]: `${WORKSPACE}/second`, [`${WORKSPACE}/second`]: '/etc/passwd' };
    const actual = canonicalisePath(`${WORKSPACE}/first`, fsWith(links));
    expect(actual).toBe(expected);
  });

  it('resolves a link written relative to the directory holding it', () => {
    const expected = '/tmp/sibling';
    const actual = canonicalisePath(`${WORKSPACE}/escape`, fsWith({ [`${WORKSPACE}/escape`]: '../sibling' }));
    expect(actual).toBe(expected);
  });

  it('gives up rather than looping forever on a link that points at itself', () => {
    const actual = canonicalisePath(`${WORKSPACE}/loop`, fsWith({ [`${WORKSPACE}/loop`]: `${WORKSPACE}/loop` }));
    expect(actual).toContain('loop');
  });
});
