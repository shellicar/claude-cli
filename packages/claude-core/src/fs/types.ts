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
  /** Owning user id. Meaningless on a platform without uids, where it is 0. */
  uid: number;
  /** Permission bits only, already masked from the raw mode. */
  mode: number;
  isFile(): boolean;
  isDirectory(): boolean;
}
