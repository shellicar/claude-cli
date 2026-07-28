import type { Writable } from 'node:stream';
import type { FileRecord } from './records';
import type { FindOptions, IFileEntry, StatResult } from './types';
import { walk } from './walk';

export abstract class IFileSystem {
  public abstract cwd(): string;
  /** Move the working directory. The authoritative move: everything reading `cwd()` live follows it. */
  public abstract chdir(path: string): void;
  public abstract homedir(): string;
  public abstract exists(path: string): Promise<boolean>;
  public abstract readFile(path: string, encoding?: BufferEncoding): Promise<string>;
  public abstract writeFile(path: string, content: string, options?: { mode?: number }): Promise<void>;
  public abstract deleteFile(path: string): Promise<void>;
  public abstract deleteDirectory(path: string): Promise<void>;
  /** Recursive, force delete — for internal housekeeping (e.g. a session cache's own temp dirs),
   *  never exposed by a tool. `deleteDirectory` above stays non-recursive; that is the tool-facing
   *  safety contract. */
  public abstract deleteDirectoryRecursive(path: string): Promise<void>;
  /** Ensures a directory exists, creating any missing parents — no content, unlike `writeFile`. */
  public abstract mkdir(path: string): Promise<void>;
  /** Creates a fresh, uniquely-named directory inside the OS temp directory, named with `prefix`, and returns its path. */
  public abstract mkdtemp(prefix: string): Promise<string>;
  public abstract rename(oldPath: string, newPath: string): Promise<void>;
  public async find(path: string, options?: FindOptions): Promise<FileRecord[]> {
    const re = options?.pattern ? new RegExp(options.pattern) : undefined;
    return walk(this, path, options ?? {}, 1, re);
  }
  public abstract appendFile(path: string, content: string): Promise<void>;
  public abstract stat(path: string): Promise<StatResult>;
  public abstract readdir(path: string): Promise<IFileEntry[]>;
  public abstract realpath(path: string): Promise<string>;
  /** One-hop symlink target (not the fully-resolved chain — that is `realpath`). */
  public abstract readlink(path: string): Promise<string>;
  public abstract getEnvVar(name: string): string | undefined;
  public abstract platform(): NodeJS.Platform;
  public abstract arch(): NodeJS.Architecture;
  /** Open a writable stream to a file, for a redirect target rather than a one-shot write. */
  public abstract createWriteStream(path: string, options: { flags: 'a' | 'w' }): Writable;
}
