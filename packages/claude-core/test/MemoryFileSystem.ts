import type { Writable } from 'node:stream';
import { IFileSystem } from '../src/fs/interfaces';
import type { IFileEntry, StatResult } from '../src/fs/types';

/**
 * Minimal in-memory `IFileSystem` for claude-core tests.
 *
 * Only `homedir()` and `getEnvVar()` are implemented because those are the
 * only surface `expandPath` uses. All other methods throw — claude-core
 * tests that need broader fs behaviour should reach for a richer fake.
 */
export class MemoryFileSystem extends IFileSystem {
  readonly #home: string;
  readonly #env = new Map<string, string>();

  public constructor(home = '/home/user') {
    super();
    this.#home = home;
  }

  public setEnvVar(name: string, value: string): void {
    this.#env.set(name, value);
  }

  public getEnvVar(name: string): string | undefined {
    return this.#env.get(name);
  }

  public homedir(): string {
    return this.#home;
  }

  public cwd(): string {
    throw new Error('MemoryFileSystem: cwd() not supported');
  }

  public chdir(): void {
    throw new Error('MemoryFileSystem: chdir() not supported');
  }

  public exists(): Promise<boolean> {
    throw new Error('MemoryFileSystem: exists() not supported');
  }

  public readFile(_path?: string, _encoding?: BufferEncoding): Promise<string> {
    throw new Error('MemoryFileSystem: readFile() not supported');
  }

  public writeFile(): Promise<void> {
    throw new Error('MemoryFileSystem: writeFile() not supported');
  }

  public deleteFile(): Promise<void> {
    throw new Error('MemoryFileSystem: deleteFile() not supported');
  }

  public deleteDirectory(): Promise<void> {
    throw new Error('MemoryFileSystem: deleteDirectory() not supported');
  }

  public appendFile(): Promise<void> {
    throw new Error('MemoryFileSystem: appendFile() not supported');
  }

  public stat(): Promise<StatResult> {
    throw new Error('MemoryFileSystem: stat() not supported');
  }

  public readdir(): Promise<IFileEntry[]> {
    throw new Error('MemoryFileSystem: readdir() not supported');
  }

  public realpath(): Promise<string> {
    throw new Error('MemoryFileSystem: realpath() not supported');
  }

  public rename(): Promise<void> {
    throw new Error('MemoryFileSystem: rename() not supported');
  }

  public platform(): NodeJS.Platform {
    throw new Error('MemoryFileSystem: platform() not supported');
  }

  public arch(): NodeJS.Architecture {
    throw new Error('MemoryFileSystem: arch() not supported');
  }

  public createWriteStream(): Writable {
    throw new Error('MemoryFileSystem: createWriteStream() not supported');
  }

  public readlink(): Promise<string> {
    throw new Error('MemoryFileSystem: readlink() not supported');
  }
}
