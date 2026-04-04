import type { FindOptions, IFileSystem } from './IFileSystem';

/**
 * In-memory filesystem implementation for testing.
 *
 * Files are stored in a Map keyed by absolute path.
 * Directories are implicit: a file at /a/b/c implies a directory at /a/b.
 * Note: empty directories cannot be represented without explicit tracking.
 */
export class MemoryFileSystem implements IFileSystem {
  private readonly files = new Map<string, string>();
  private readonly home: string;

  constructor(initial?: Record<string, string>, home = '/home/user') {
    this.home = home;
    if (initial) {
      for (const [path, content] of Object.entries(initial)) {
        this.files.set(path, content);
      }
    }
  }

  homedir(): string {
    return this.home;
  }


  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async deleteFile(path: string): Promise<void> {
    if (!this.files.has(path)) {
      const err = new Error(`ENOENT: no such file or directory, unlink '${path}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    this.files.delete(path);
  }

  async deleteDirectory(path: string): Promise<void> {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const directContents = [...this.files.keys()].filter((p) => {
      if (!p.startsWith(prefix)) return false;
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

  async find(path: string, options?: FindOptions): Promise<string[]> {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const type = options?.type ?? 'file';
    const exclude = options?.exclude ?? [];
    const maxDepth = options?.maxDepth;
    const pattern = options?.pattern;

    // Check that the directory exists (at least one file lives under it).
    // Empty directories cannot be represented in MemoryFileSystem.
    const dirExists = [...this.files.keys()].some((p) => p.startsWith(prefix));
    if (!dirExists) {
      const err = new Error(`ENOENT: no such file or directory, scandir '${path}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }

    const results: string[] = [];
    const dirs = new Set<string>();

    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) continue;

      const relative = filePath.slice(prefix.length);
      const parts = relative.split('/');

      if (maxDepth !== undefined && parts.length > maxDepth) continue;
      if (parts.some((p) => exclude.includes(p))) continue;

      if (type === 'directory' || type === 'both') {
        for (let i = 1; i < parts.length; i++) {
          const dirPath = prefix + parts.slice(0, i).join('/');
          if (!dirs.has(dirPath)) {
            const dirName = parts[i - 1];
            if (!exclude.includes(dirName) && (maxDepth === undefined || i <= maxDepth)) {
              dirs.add(dirPath);
            }
          }
        }
      }

      if (type === 'file' || type === 'both') {
        const fileName = parts[parts.length - 1];
        if (!pattern || matchGlob(pattern, fileName)) {
          results.push(filePath);
        }
      }
    }

    if (type === 'directory' || type === 'both') {
      for (const dir of dirs) {
        const dirName = dir.split('/').pop() ?? '';
        if (!pattern || matchGlob(pattern, dirName)) {
          results.push(dir);
        }
      }
    }

    return results.sort();
  }
}

function matchGlob(pattern: string, name: string): boolean {
  // Strip leading **/ prefixes — directory traversal is handled by recursion
  const normalised = pattern.replace(/^(\*\*\/)+/, '');
  const escaped = normalised
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(name);
}
