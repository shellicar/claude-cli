import { join } from 'node:path';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { IFileEntry, StatResult } from '@shellicar/claude-core/fs/types';
import { describe, expect, it } from 'vitest';
import { createFind } from '../src/Find/Find';
import { call } from './helpers';

/**
 * Mock filesystem representing this structure:
 *
 *   /fixture/
 *     circle           (symlink → /fixture)
 *     dir-link         (symlink → /fixture/real-dir)
 *     file-link.txt    (symlink → /fixture/real-file.txt)
 *     other-dir/
 *       other.txt
 *     other-link       (symlink → /fixture/other-dir)
 *     real-dir/
 *       inner.txt
 *     real-file.txt
 *
 * Entries in readdir use a specific order to make tests meaningful:
 * - dir-link before real-dir: the cycle-detector marks /fixture/real-dir visited
 *   via dir-link, so dir-link/inner.txt appears in results and real-dir returns [].
 * - other-link before other-dir: if the exclude check were broken for symlinks,
 *   other-link would be entered first, marking /fixture/other-dir visited, and
 *   other-link/other.txt would appear in results. The negative assertion in the
 *   exclude test would then catch the regression.
 */
const ROOT = '/fixture';

function makeFile(name: string): IFileEntry {
  return { name, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
}

function makeDir(name: string): IFileEntry {
  return { name, isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false };
}

function makeSymlink(name: string): IFileEntry {
  return { name, isFile: () => false, isDirectory: () => false, isSymbolicLink: () => true };
}

function fileStat(): StatResult {
  return { size: 0, isFile: () => true, isDirectory: () => false };
}

function dirStat(): StatResult {
  return { size: 0, isFile: () => false, isDirectory: () => true };
}

class SymlinkMockFileSystem extends IFileSystem {
  public getEnvVar(_name: string): string | undefined {
    return undefined;
  }

  public cwd(): string {
    return ROOT;
  }

  public homedir(): string {
    return '/home/user';
  }

  public async exists(): Promise<boolean> {
    return false;
  }

  public async readFile(): Promise<string> {
    throw new Error('not implemented');
  }

  public async writeFile(): Promise<void> {
    throw new Error('not implemented');
  }

  public async deleteFile(): Promise<void> {
    throw new Error('not implemented');
  }

  public async deleteDirectory(): Promise<void> {
    throw new Error('not implemented');
  }

  public async appendFile(): Promise<void> {
    throw new Error('not implemented');
  }

  public async stat(path: string): Promise<StatResult> {
    const dirs = new Set([ROOT, `${ROOT}/real-dir`, `${ROOT}/dir-link`, `${ROOT}/other-dir`, `${ROOT}/other-link`, `${ROOT}/circle`]);
    const files = new Set([`${ROOT}/real-file.txt`, `${ROOT}/file-link.txt`, `${ROOT}/real-dir/inner.txt`, `${ROOT}/dir-link/inner.txt`, `${ROOT}/other-dir/other.txt`, `${ROOT}/other-link/other.txt`]);
    if (dirs.has(path)) {
      return dirStat();
    }
    if (files.has(path)) {
      return fileStat();
    }
    const err = new Error(`ENOENT: no such file or directory, stat '${path}'`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  }

  public async readdir(path: string): Promise<IFileEntry[]> {
    const real = await this.realpath(path);
    if (real === ROOT) {
      // dir-link before real-dir; other-link before other-dir — see JSDoc above
      return [makeSymlink('circle'), makeSymlink('dir-link'), makeSymlink('file-link.txt'), makeSymlink('other-link'), makeDir('other-dir'), makeDir('real-dir'), makeFile('real-file.txt')];
    }
    if (real === `${ROOT}/real-dir`) {
      return [makeFile('inner.txt')];
    }
    if (real === `${ROOT}/other-dir`) {
      return [makeFile('other.txt')];
    }
    const err = new Error(`ENOENT: no such file or directory, scandir '${path}'`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  }

  public async realpath(path: string): Promise<string> {
    const symlinks = new Map<string, string>([
      [`${ROOT}/circle`, ROOT],
      [`${ROOT}/dir-link`, `${ROOT}/real-dir`],
      [`${ROOT}/file-link.txt`, `${ROOT}/real-file.txt`],
      [`${ROOT}/other-link`, `${ROOT}/other-dir`],
    ]);
    return symlinks.get(path) ?? path;
  }
}

describe('createFind — symlinks', () => {
  it('discovers files that are symlinks', async () => {
    const Find = createFind(new SymlinkMockFileSystem());
    const actual = await call(Find, { path: ROOT });
    const expected = join(ROOT, 'file-link.txt');
    expect(actual.values).toContain(expected);
  });

  it('discovers files inside symlinked directories', async () => {
    const Find = createFind(new SymlinkMockFileSystem());
    const actual = await call(Find, { path: ROOT });
    const expected = join(ROOT, 'dir-link', 'inner.txt');
    expect(actual.values).toContain(expected);
  });

  it('does not loop infinitely on circular symlinks', async () => {
    const Find = createFind(new SymlinkMockFileSystem());
    const actual = await call(Find, { path: ROOT });
    const expected = 'files';
    expect(actual.type).toBe(expected);
  });

  it('symlinked files match pattern filters', async () => {
    const Find = createFind(new SymlinkMockFileSystem());
    const actual = await call(Find, { path: ROOT, pattern: '\\.txt$' });
    const expected = join(ROOT, 'file-link.txt');
    expect(actual.values).toContain(expected);
  });

  it('symlinked directories are found when type is directory', async () => {
    const Find = createFind(new SymlinkMockFileSystem());
    const actual = await call(Find, { path: ROOT, type: 'directory' });
    const expected = join(ROOT, 'dir-link');
    expect(actual.values).toContain(expected);
  });

  it('does not recurse into symlinked directories when followSymlinks is false', async () => {
    const Find = createFind(new SymlinkMockFileSystem());
    const actual = await call(Find, { path: ROOT, followSymlinks: false });
    const expected = join(ROOT, 'dir-link', 'inner.txt');
    expect(actual.values).not.toContain(expected);
  });

  it('still returns symlinked files when followSymlinks is false', async () => {
    const Find = createFind(new SymlinkMockFileSystem());
    const actual = await call(Find, { path: ROOT, followSymlinks: false });
    const expected = join(ROOT, 'file-link.txt');
    expect(actual.values).toContain(expected);
  });

  it('exclude list applies to symlinked directory names', async () => {
    const Find = createFind(new SymlinkMockFileSystem());
    const actual = await call(Find, { path: ROOT, exclude: ['other-link'] });
    const expected = join(ROOT, 'dir-link', 'inner.txt');
    expect(actual.values).toContain(expected);
    expect(actual.values).not.toContain(join(ROOT, 'other-link', 'other.txt'));
  });
});
