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
  private readonly env = new Map<string, string>();
  private readonly home: string;
  private readonly cwd_: string;

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

  public homedir(): string {
    return this.home;
  }

  public async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  public async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return content;
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
}
