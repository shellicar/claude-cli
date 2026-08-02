import type { Writable } from 'node:stream';
import type { FileRecord } from './records';
import type { FindOptions, IFileEntry, StatResult } from './types';
import { walk } from './walk';

export abstract class IFileSystem {
  public abstract cwd(): string;
  /** Move the working directory. The authoritative move: everything reading `cwd()` live follows it. */
  public abstract chdir(path: string): void;
  public abstract homedir(): string;
  public abstract tmpdir(): string;
  /** The current user's id, or null on a platform that has no such concept (Windows). */
  public abstract uid(): number | null;
  /** Create a directory and any missing parents, with `mode` on each one it creates. Succeeds when
   *  the directory already exists, in which case the existing mode is left as it is. */
  public abstract mkdir(path: string, mode?: number): Promise<void>;
  /** Stat without following a final symlink, so a planted link reports as a link, not its target. */
  public abstract lstat(path: string): Promise<StatResult>;
  public abstract exists(path: string): Promise<boolean>;
  public abstract readFile(path: string, encoding?: BufferEncoding): Promise<string>;
  /** The file's raw bytes, for a reader that scans rather than decodes. */
  public abstract readFileBytes(path: string): Promise<Buffer>;
  public abstract writeFile(path: string, content: string): Promise<void>;
  public abstract deleteFile(path: string): Promise<void>;
  public abstract deleteDirectory(path: string): Promise<void>;
  public abstract rename(oldPath: string, newPath: string): Promise<void>;
  public async find(path: string, options?: FindOptions): Promise<FileRecord[]> {
    const re = options?.pattern ? new RegExp(options.pattern) : undefined;
    return walk(this, path, options ?? {}, 1, re);
  }
  public abstract appendFile(path: string, content: string): Promise<void>;
  public abstract stat(path: string): Promise<StatResult>;
  public abstract readdir(path: string): Promise<IFileEntry[]>;
  public abstract realpath(path: string): Promise<string>;
  /** Sync counterparts, for the path canonicaliser: the permission decision it feeds is synchronous. */
  public abstract existsSync(path: string): boolean;
  public abstract realpathSync(path: string): string;
  /** One-hop symlink target (not the fully-resolved chain — that is `realpath`). */
  public abstract readlink(path: string): Promise<string>;
  public abstract getEnvVar(name: string): string | undefined;
  public abstract platform(): NodeJS.Platform;
  public abstract arch(): NodeJS.Architecture;
  /** Open a writable stream to a file, for a redirect target rather than a one-shot write. */
  public abstract createWriteStream(path: string, options: { flags: 'a' | 'w' }): Writable;
}
