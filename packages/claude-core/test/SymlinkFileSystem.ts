import type { Writable } from 'node:stream';
import { IFileSystem } from '../src/fs/interfaces';
import type { IFileEntry, StatResult } from '../src/fs/types';

type SymlinkFileSystemOptions = {
  cwd: string;
  /** Symlink path to its target. Any path absent from this map is not a link. */
  links: Record<string, string>;
};

/**
 * An `IFileSystem` fake covering only what the path canonicaliser reads: the working directory and
 * where a symlink points. Everything else is unreachable, so a test that strays outside that
 * surface fails loudly rather than quietly reading a default.
 */
export class SymlinkFileSystem extends IFileSystem {
  readonly #options: SymlinkFileSystemOptions;

  public constructor(options: SymlinkFileSystemOptions) {
    super();
    this.#options = options;
  }

  public cwd(): string {
    return this.#options.cwd;
  }

  public readlinkSync(target: string): string | null {
    return this.#options.links[target] ?? null;
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
