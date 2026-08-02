import type { Stats } from 'node:fs';
import { createWriteStream, existsSync, readlinkSync as fsReadlinkSync } from 'node:fs';
import { appendFile, lstat as fsLstat, readdir as fsReaddir, readlink as fsReadlink, realpath as fsRealpath, rename as fsRename, stat as fsStat, mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { homedir as osHomedir, tmpdir as osTmpdir } from 'node:os';
import { dirname } from 'node:path';
import type { Writable } from 'node:stream';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { IFileEntry, StatResult } from '@shellicar/claude-core/fs/types';

// 0o777: the permission bits, without the file-type bits node packs into the same number.
const PERMISSION_BITS = 0o777;

function toStatResult(s: Stats): StatResult {
  return {
    size: s.size,
    uid: s.uid,
    mode: s.mode & PERMISSION_BITS,
    isFile: () => s.isFile(),
    isDirectory: () => s.isDirectory(),
  };
}

/**
 * Production filesystem implementation using Node.js fs APIs.
 */
export class NodeFileSystem extends IFileSystem {
  public getEnvVar(name: string): string | undefined {
    return process.env[name];
  }

  public cwd(): string {
    return process.cwd();
  }

  public chdir(path: string): void {
    process.chdir(path);
  }

  public homedir(): string {
    return osHomedir();
  }

  public tmpdir(): string {
    return osTmpdir();
  }

  public uid(): number | null {
    return process.getuid?.() ?? null;
  }

  public async mkdir(path: string, mode?: number): Promise<void> {
    await mkdir(path, mode == null ? { recursive: true } : { recursive: true, mode });
  }

  public async lstat(path: string): Promise<StatResult> {
    return toStatResult(await fsLstat(path));
  }

  public async exists(path: string): Promise<boolean> {
    return existsSync(path);
  }

  public async readFile(path: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    return readFile(path, encoding);
  }

  public async readFileBytes(path: string): Promise<Buffer> {
    return readFile(path);
  }

  public async writeFile(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }

  public async deleteFile(path: string): Promise<void> {
    await rm(path);
  }

  public async deleteDirectory(path: string): Promise<void> {
    await rmdir(path);
  }

  public async appendFile(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, content, 'utf-8');
  }

  public async stat(path: string): Promise<StatResult> {
    return toStatResult(await fsStat(path));
  }

  public async readdir(path: string): Promise<IFileEntry[]> {
    const entries = await fsReaddir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isFile: () => entry.isFile(),
      isDirectory: () => entry.isDirectory(),
      isSymbolicLink: () => entry.isSymbolicLink(),
    }));
  }

  public readlinkSync(path: string): string | null {
    try {
      return fsReadlinkSync(path);
    } catch {
      // EINVAL (not a link) and ENOENT (not there) are both "nothing to follow".
      return null;
    }
  }

  public async realpath(path: string): Promise<string> {
    return fsRealpath(path);
  }

  public async rename(oldPath: string, newPath: string): Promise<void> {
    await fsRename(oldPath, newPath);
  }

  public platform(): NodeJS.Platform {
    return process.platform;
  }

  public arch(): NodeJS.Architecture {
    return process.arch;
  }

  public createWriteStream(path: string, options: { flags: 'a' | 'w' }): Writable {
    return createWriteStream(path, options);
  }

  public async readlink(path: string): Promise<string> {
    return fsReadlink(path);
  }
}
