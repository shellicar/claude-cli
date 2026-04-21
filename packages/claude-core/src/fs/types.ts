export interface IFileEntry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}
export interface FindOptions {
  pattern?: string;
  type?: 'file' | 'directory' | 'both';
  exclude?: string[];
  maxDepth?: number;
  followSymlinks?: boolean;
}
export interface StatResult {
  size: number;
  isFile(): boolean;
  isDirectory(): boolean;
}
