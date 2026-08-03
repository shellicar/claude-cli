import path from 'node:path';
import type { Writable } from 'node:stream';
import { IFileSystem } from '../src/fs/interfaces';
import type { IFileEntry, StatResult } from '../src/fs/types';

// What the OS gives up after. macOS uses 32, Linux 40; the exact number does not matter here, only
// that a cycle terminates with ELOOP rather than spinning.
const MAX_TRAVERSALS = 32;

type SymlinkFileSystemOptions = {
  cwd: string;
  /** Files and directories that exist. Ancestors are implied, so only leaves need listing. */
  entries?: string[];
  /** Symlink path to its target, absolute or relative to the directory holding the link. */
  links?: Record<string, string>;
};

function errno(code: string, message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

/**
 * An `IFileSystem` fake covering what the path canonicaliser reads, modelled closely enough that the
 * three sync calls behave as the real ones do: `existsNoFollowSync` sees a dangling link as present,
 * `realpathSync` follows the whole chain and throws ENOENT or ELOOP, and `readlinkSync` reports one
 * hop. A fake that resolved more forgivingly than the OS would prove nothing.
 *
 * Everything outside that surface throws, so a test that strays fails loudly rather than reading a
 * quiet default.
 */
export class SymlinkFileSystem extends IFileSystem {
  readonly #cwd: string;
  readonly #entries: Set<string>;
  readonly #links: Record<string, string>;

  public constructor(options: SymlinkFileSystemOptions) {
    super();
    this.#cwd = options.cwd;
    this.#links = options.links ?? {};
    this.#entries = new Set(['/']);
    for (const entry of options.entries ?? []) {
      let current = entry;
      while (current !== path.dirname(current)) {
        this.#entries.add(current);
        current = path.dirname(current);
      }
    }
  }

  public cwd(): string {
    return this.#cwd;
  }

  public existsNoFollowSync(target: string): boolean {
    const candidate = this.#withResolvedParent(target);
    return candidate != null && (this.#links[candidate] != null || this.#entries.has(candidate));
  }

  public readlinkSync(target: string): string | null {
    const candidate = this.#withResolvedParent(target);
    return candidate == null ? null : (this.#links[candidate] ?? null);
  }

  /**
   * Both lstat and readlink resolve every component of a path except the last, so a link named
   * through a symlinked ancestor is still found. Null when the ancestors themselves do not resolve.
   */
  #withResolvedParent(target: string): string | null {
    const parent = path.dirname(target);
    if (parent === target) {
      return target;
    }
    try {
      return path.join(this.#resolve(parent, { traversals: 0 }), path.basename(target));
    } catch {
      return null;
    }
  }

  public realpathSync(target: string): string {
    return this.#resolve(target, { traversals: 0 });
  }

  #resolve(target: string, budget: { traversals: number }): string {
    let resolved = '/';
    for (const part of target.split('/').filter(Boolean)) {
      const candidate = path.join(resolved, part);
      const link = this.#links[candidate];
      if (link != null) {
        if (++budget.traversals > MAX_TRAVERSALS) {
          throw errno('ELOOP', `ELOOP: too many symbolic links encountered, realpath '${target}'`);
        }
        resolved = this.#resolve(path.resolve(resolved, link), budget);
        continue;
      }
      if (!this.#entries.has(candidate)) {
        throw errno('ENOENT', `ENOENT: no such file or directory, realpath '${target}'`);
      }
      resolved = candidate;
    }
    return resolved;
  }

  public getEnvVar(): string | undefined {
    return undefined;
  }

  public homedir(): string {
    return '/home/user';
  }

  public chdir(): void {
    throw new Error('SymlinkFileSystem: chdir() not supported');
  }

  public tmpdir(): string {
    throw new Error('SymlinkFileSystem: tmpdir() not supported');
  }

  public uid(): number | null {
    throw new Error('SymlinkFileSystem: uid() not supported');
  }

  public mkdir(): Promise<void> {
    throw new Error('SymlinkFileSystem: mkdir() not supported');
  }

  public lstat(): Promise<StatResult> {
    throw new Error('SymlinkFileSystem: lstat() not supported');
  }

  public exists(): Promise<boolean> {
    throw new Error('SymlinkFileSystem: exists() not supported');
  }

  public readFile(): Promise<string> {
    throw new Error('SymlinkFileSystem: readFile() not supported');
  }

  public readFileBytes(): Promise<Buffer> {
    throw new Error('SymlinkFileSystem: readFileBytes() not supported');
  }

  public writeFile(): Promise<void> {
    throw new Error('SymlinkFileSystem: writeFile() not supported');
  }

  public deleteFile(): Promise<void> {
    throw new Error('SymlinkFileSystem: deleteFile() not supported');
  }

  public deleteDirectory(): Promise<void> {
    throw new Error('SymlinkFileSystem: deleteDirectory() not supported');
  }

  public rename(): Promise<void> {
    throw new Error('SymlinkFileSystem: rename() not supported');
  }

  public appendFile(): Promise<void> {
    throw new Error('SymlinkFileSystem: appendFile() not supported');
  }

  public stat(): Promise<StatResult> {
    throw new Error('SymlinkFileSystem: stat() not supported');
  }

  public readdir(): Promise<IFileEntry[]> {
    throw new Error('SymlinkFileSystem: readdir() not supported');
  }

  public realpath(): Promise<string> {
    throw new Error('SymlinkFileSystem: realpath() not supported');
  }

  public readlink(): Promise<string> {
    throw new Error('SymlinkFileSystem: readlink() not supported');
  }

  public platform(): NodeJS.Platform {
    throw new Error('SymlinkFileSystem: platform() not supported');
  }

  public arch(): NodeJS.Architecture {
    throw new Error('SymlinkFileSystem: arch() not supported');
  }

  public createWriteStream(): Writable {
    throw new Error('SymlinkFileSystem: createWriteStream() not supported');
  }
}
