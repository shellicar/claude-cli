export interface FindOptions {
  pattern?: string;
  type?: 'file' | 'directory' | 'both';
  exclude?: string[];
  maxDepth?: number;
  followSymlinks?: boolean;
}

export interface StatResult {
  size: number;
}

export abstract class IFileSystem {
  public abstract cwd(): string;
  public abstract homedir(): string;
  public abstract exists(path: string): Promise<boolean>;
  public abstract readFile(path: string): Promise<string>;
  public abstract writeFile(path: string, content: string): Promise<void>;
  public abstract deleteFile(path: string): Promise<void>;
  public abstract deleteDirectory(path: string): Promise<void>;
  public abstract find(path: string, options?: FindOptions): Promise<string[]>;
  public abstract appendFile(path: string, content: string): Promise<void>;
  public abstract stat(path: string): Promise<StatResult>;
}
