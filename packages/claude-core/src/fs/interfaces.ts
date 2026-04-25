import type { FindOptions, IFileEntry, StatResult } from './types';
import { walk } from './walk';

export abstract class IFileSystem {
  public abstract cwd(): string;
  public abstract homedir(): string;
  public abstract exists(path: string): Promise<boolean>;
  public abstract readFile(path: string, encoding?: BufferEncoding): Promise<string>;
  public abstract writeFile(path: string, content: string): Promise<void>;
  public abstract deleteFile(path: string): Promise<void>;
  public abstract deleteDirectory(path: string): Promise<void>;
  public async find(path: string, options?: FindOptions): Promise<string[]> {
    const re = options?.pattern ? new RegExp(options.pattern) : undefined;
    return walk(this, path, options ?? {}, 1, re);
  }
  public abstract appendFile(path: string, content: string): Promise<void>;
  public abstract stat(path: string): Promise<StatResult>;
  public abstract readdir(path: string): Promise<IFileEntry[]>;
  public abstract realpath(path: string): Promise<string>;
  public abstract getEnvVar(name: string): string | undefined;
}
