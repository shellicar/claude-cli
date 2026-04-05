export interface FindOptions {
  pattern?: string;
  type?: 'file' | 'directory' | 'both';
  exclude?: string[];
  maxDepth?: number;
}

export interface StatResult {
  size: number;
}

export interface IFileSystem {
  homedir(): string;
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  deleteDirectory(path: string): Promise<void>;
  find(path: string, options?: FindOptions): Promise<string[]>;
  stat(path: string): Promise<StatResult>;
}
