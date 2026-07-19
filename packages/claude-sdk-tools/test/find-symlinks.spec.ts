import { join } from 'node:path';
import type { Writable } from 'node:stream';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { IFileEntry, StatResult } from '@shellicar/claude-core/fs/types';
import { describe, expect, it } from 'vitest';
import { createFind, FindModel } from '../src/Find/Find';

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
 * readdir order — dir-link before real-dir, other-link before other-dir — exercises the
 * cycle-detector and the exclude check for symlinks, as in the original fixture.
 */
const ROOT = '/fixture';

const SYMLINKS = new Map<string, string>([
  [`${ROOT}/circle`, ROOT],
  [`${ROOT}/dir-link`, `${ROOT}/real-dir`],
  [`${ROOT}/file-link.txt`, `${ROOT}/real-file.txt`],
  [`${ROOT}/other-link`, `${ROOT}/other-dir`],
]);

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
  public getEnvVar(): string | undefined {
    return undefined;
  }

  public platform(): NodeJS.Platform {
    return 'linux';
  }

  public arch(): NodeJS.Architecture {
    return 'x64';
  }

  public createWriteStream(): Writable {
    throw new Error('not implemented');
  }

  public cwd(): string {
    return ROOT;
  }
  public chdir(): void {}
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

  public async rename(): Promise<void> {
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
    return SYMLINKS.get(path) ?? path;
  }

  public async readlink(path: string): Promise<string> {
    const target = SYMLINKS.get(path);
    if (target === undefined) {
      const err = new Error(`EINVAL: invalid argument, readlink '${path}'`) as NodeJS.ErrnoException;
      err.code = 'EINVAL';
      throw err;
    }
    return target;
  }
}

const paths = async (input: Record<string, unknown>) => (await createFind(new SymlinkMockFileSystem()).run(FindModel.parse({ path: ROOT, ...input }))).files.map((f) => f.path);

describe('createFind — symlinks', () => {
  it('discovers files that are symlinks', async () => {
    const expected = join(ROOT, 'file-link.txt');
    expect(await paths({})).toContain(expected);
  });

  it('discovers files inside symlinked directories', async () => {
    const expected = join(ROOT, 'dir-link', 'inner.txt');
    expect(await paths({})).toContain(expected);
  });

  it('does not loop infinitely on circular symlinks', async () => {
    const actual = (await createFind(new SymlinkMockFileSystem()).run(FindModel.parse({ path: ROOT }))).kind;
    expect(actual).toBe('files');
  });

  it('records a symlinked file with the link type', async () => {
    const fs = new SymlinkMockFileSystem();
    const result = await createFind(fs).run(FindModel.parse({ path: ROOT }));
    const actual = result.files.find((f) => f.path === join(ROOT, 'file-link.txt'))?.type;
    expect(actual).toBe('link');
  });

  it('records the one-hop target on a symlinked file', async () => {
    const fs = new SymlinkMockFileSystem();
    const result = await createFind(fs).run(FindModel.parse({ path: ROOT }));
    const actual = result.files.find((f) => f.path === join(ROOT, 'file-link.txt'))?.target;
    expect(actual).toBe(`${ROOT}/real-file.txt`);
  });

  it('symlinked files match pattern filters', async () => {
    const expected = join(ROOT, 'file-link.txt');
    expect(await paths({ pattern: '\\.txt$' })).toContain(expected);
  });

  it('symlinked directories are found when type is directory', async () => {
    const expected = join(ROOT, 'dir-link');
    expect(await paths({ type: 'directory' })).toContain(expected);
  });

  it('does not recurse into symlinked directories when followSymlinks is false', async () => {
    const expected = join(ROOT, 'dir-link', 'inner.txt');
    expect(await paths({ followSymlinks: false })).not.toContain(expected);
  });

  it('still returns symlinked files when followSymlinks is false', async () => {
    const expected = join(ROOT, 'file-link.txt');
    expect(await paths({ followSymlinks: false })).toContain(expected);
  });

  it('exclude list applies to symlinked directory names', async () => {
    const actual = await paths({ exclude: ['other-link'] });
    expect(actual).not.toContain(join(ROOT, 'other-link', 'other.txt'));
  });
});
