import { Writable } from 'node:stream';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { IFileEntry, StatResult } from '@shellicar/claude-core/fs/types';

/**
 * In-memory filesystem implementation for testing.
 *
 * Files are stored in a Map keyed by absolute path.
 * Directories are implicit: a file at /a/b/c implies a directory at /a/b.
 * Note: empty directories cannot be represented without explicit tracking.
 */
export class MemoryFileSystem extends IFileSystem {
  private readonly files = new Map<string, string>();
  private readonly dirs = new Set<string>();
  private uid_: number | null = 501;
  private readonly dirModes = new Map<string, number>();
  private readonly dirOwners = new Map<string, number>();
  private readonly links = new Set<string>();
  private readonly env = new Map<string, string>();
  private readonly home: string;
  private cwd_: string;

  public constructor(initial?: Record<string, string>, home = '/home/user', cwd = '/cwd') {
    super();
    this.home = home;
    this.cwd_ = cwd;
    if (initial) {
      for (const [path, content] of Object.entries(initial)) {
        this.files.set(path, content);
      }
    }
  }

  public setEnvVar(name: string, value: string) {
    this.env.set(name, value);
  }

  public getEnvVar(name: string): string | undefined {
    return this.env.get(name);
  }

  public cwd(): string {
    return this.cwd_;
  }

  public chdir(path: string): void {
    if (this.files.has(path)) {
      const err = new Error(`ENOTDIR: not a directory, chdir '${path}'`) as NodeJS.ErrnoException;
      err.code = 'ENOTDIR';
      throw err;
    }
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const known = path === this.home || path === this.cwd_ || [...this.files.keys()].some((p) => p.startsWith(prefix));
    if (!known) {
      const err = new Error(`ENOENT: no such file or directory, chdir '${path}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    this.cwd_ = path;
  }

  public homedir(): string {
    return this.home;
  }

  public tmpdir(): string {
    return '/tmp';
  }

  public setUid(value: number | null): void {
    this.uid_ = value;
  }

  public uid(): number | null {
    return this.uid_;
  }

  public async mkdir(path: string, mode = 0o755): Promise<void> {
    if (!this.dirs.has(path)) {
      this.dirs.add(path);
      this.dirModes.set(path, mode);
      this.dirOwners.set(path, this.uid_ ?? 0);
    }
  }

  /** Plant a directory owned by someone else, or with looser bits, the way a squatter would. */
  public setDirectory(path: string, options: { uid?: number; mode?: number } = {}): void {
    this.dirs.add(path);
    this.dirModes.set(path, options.mode ?? 0o700);
    this.dirOwners.set(path, options.uid ?? this.uid_ ?? 0);
  }

  /** Plant a symlink where a directory is expected. */
  public setSymlink(path: string): void {
    this.dirs.add(path);
    this.links.add(path);
  }

  public async lstat(path: string): Promise<StatResult> {
    if (!this.dirs.has(path) && !this.files.has(path)) {
      const err = new Error(`ENOENT: no such file or directory, lstat '${path}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    const isLink = this.links.has(path);
    return {
      size: 0,
      uid: this.dirOwners.get(path) ?? this.uid_ ?? 0,
      mode: this.dirModes.get(path) ?? 0o700,
      isFile: () => false,
      isDirectory: () => this.dirs.has(path) && !isLink,
    };
  }

  public async exists(path: string): Promise<boolean> {
    return this.existsSync(path);
  }

  public existsSync(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }

  /** No symlinks: a path resolves to itself. */
  public realpathSync(path: string): string {
    return path;
  }

  public async readFile(path: string, encoding?: BufferEncoding): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    if (encoding === 'base64') {
      return Buffer.from(content).toString('base64');
    }
    return content;
  }

  public async readFileBytes(path: string): Promise<Buffer> {
    return Buffer.from(await this.readFile(path), 'utf-8');
  }

  public async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  public async deleteFile(path: string): Promise<void> {
    if (!this.files.has(path)) {
      const err = new Error(`ENOENT: no such file or directory, unlink '${path}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    this.files.delete(path);
  }

  public async deleteDirectory(path: string): Promise<void> {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const directContents = [...this.files.keys()].filter((p) => {
      if (!p.startsWith(prefix)) {
        return false;
      }
      const relative = p.slice(prefix.length);
      return !relative.includes('/');
    });
    if (directContents.length > 0) {
      const err = new Error(`ENOTEMPTY: directory not empty, rmdir '${path}'`) as NodeJS.ErrnoException;
      err.code = 'ENOTEMPTY';
      throw err;
    }
    // Directories are implicit \u2014 nothing to remove when empty
  }

  public async stat(path: string): Promise<StatResult> {
    const content = this.files.get(path);
    if (content === undefined) {
      const err = new Error(`ENOENT: no such file or directory, stat '${path}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return {
      size: content.length,
      uid: this.uid_ ?? 0,
      mode: 0o600,
      isFile: () => true,
      isDirectory: () => false,
    };
  }

  public async appendFile(path: string, content: string): Promise<void> {
    const existing = this.files.get(path) ?? '';
    this.files.set(path, existing + content);
  }

  public async readdir(path: string): Promise<IFileEntry[]> {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const exists = [...this.files.keys()].some((p) => p.startsWith(prefix));
    if (!exists) {
      const err = new Error(`ENOENT: no such file or directory, scandir '${path}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    const children = new Map<string, 'file' | 'directory'>();
    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) {
        continue;
      }
      const relative = filePath.slice(prefix.length);
      const parts = relative.split('/');
      const first = parts[0];
      if (parts.length === 1) {
        children.set(first, 'file');
      } else if (!children.has(first)) {
        children.set(first, 'directory');
      }
    }
    return [...children.entries()].map(([name, kind]) => ({
      name,
      isFile: () => kind === 'file',
      isDirectory: () => kind === 'directory',
      isSymbolicLink: () => false,
    }));
  }

  public async realpath(path: string): Promise<string> {
    return path;
  }

  public async rename(oldPath: string, newPath: string): Promise<void> {
    const content = this.files.get(oldPath);
    if (content === undefined) {
      const err = new Error(`ENOENT: no such file or directory, rename '${oldPath}' -> '${newPath}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    this.files.set(newPath, content);
    this.files.delete(oldPath);
  }

  #platform: NodeJS.Platform = 'darwin';

  public setPlatform(p: NodeJS.Platform): void {
    this.#platform = p;
  }

  public platform(): NodeJS.Platform {
    return this.#platform;
  }

  #arch: NodeJS.Architecture = 'arm64';

  public setArch(a: NodeJS.Architecture): void {
    this.#arch = a;
  }

  public arch(): NodeJS.Architecture {
    return this.#arch;
  }

  public createWriteStream(path: string, options: { flags: 'a' | 'w' }): Writable {
    const initial = options.flags === 'a' ? (this.files.get(path) ?? '') : '';
    const chunks: string[] = [initial];
    const files = this.files;
    return new Writable({
      write(chunk, encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk));
        files.set(path, chunks.join(''));
        callback();
      },
    });
  }

  public async readlink(path: string): Promise<string> {
    const err = new Error(`EINVAL: invalid argument, readlink '${path}'`) as NodeJS.ErrnoException;
    err.code = 'EINVAL';
    throw err;
  }
}
