export type FileType = 'file' | 'dir' | 'link';

/** One file/dir/link record produced by traversal.
 *
 * `path` is the addressable value the downstream paths mission marks. `size` is bytes;
 * absent for a directory. `target` is the one-hop symlink target (ls -l style), present
 * only for a link. */
export interface FileRecord {
  path: string;
  type: FileType;
  size?: number;
  target?: string;
}
