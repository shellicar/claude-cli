import { describe, expect, it } from 'vitest';
import { canonicalisePath } from '../src/fs/canonicalisePath';
import { SymlinkFileSystem } from './SymlinkFileSystem';

const CWD = '/project';
const WORKSPACE = '/tmp/scratchpad';

function fsWith(links: Record<string, string>, dirs: string[] = []): SymlinkFileSystem {
  return new SymlinkFileSystem({ cwd: CWD, links, dirs });
}

describe('canonicalisePath', () => {
  it('resolves a relative path against the working directory', () => {
    const expected = '/project/src/file.ts';
    const actual = canonicalisePath('src/file.ts', fsWith({}));
    expect(actual).toBe(expected);
  });

  it('collapses dot segments', () => {
    const expected = '/project/file.ts';
    const actual = canonicalisePath('src/../file.ts', fsWith({}));
    expect(actual).toBe(expected);
  });

  it('leaves a real path untouched', () => {
    const expected = `${WORKSPACE}/notes.md`;
    const actual = canonicalisePath(`${WORKSPACE}/notes.md`, fsWith({}, [WORKSPACE]));
    expect(actual).toBe(expected);
  });

  it('resolves a symlink to the file it points at', () => {
    const expected = '/etc/passwd';
    const actual = canonicalisePath(`${WORKSPACE}/escape`, fsWith({ [`${WORKSPACE}/escape`]: '/etc/passwd' }, [WORKSPACE]));
    expect(actual).toBe(expected);
  });

  it('resolves a file that does not exist yet through a symlinked parent', () => {
    const expected = '/etc/newfile';
    const actual = canonicalisePath(`${WORKSPACE}/escape/newfile`, fsWith({ [`${WORKSPACE}/escape`]: '/etc' }, [WORKSPACE]));
    expect(actual).toBe(expected);
  });

  it('resolves a symlinked directory several levels above the target', () => {
    const expected = '/etc/a/b/c.txt';
    const actual = canonicalisePath(`${WORKSPACE}/escape/a/b/c.txt`, fsWith({ [`${WORKSPACE}/escape`]: '/etc' }, [WORKSPACE]));
    expect(actual).toBe(expected);
  });

  it('leaves a path whose ancestors all fail to exist as its plain absolute form', () => {
    const expected = '/nowhere/at/all.txt';
    const actual = canonicalisePath('/nowhere/at/all.txt', fsWith({}));
    expect(actual).toBe(expected);
  });
});
