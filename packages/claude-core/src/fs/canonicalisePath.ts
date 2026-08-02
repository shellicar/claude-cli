import path from 'node:path';
import { expandPath } from './expandPath';
import type { IFileSystem } from './interfaces';

/**
 * Canonicalise a marked tool path to the single absolute form every consumer reads: the permission
 * zoning, the approval display, and the tool handler itself.
 *
 * Expands `~` and `$VAR`, resolves against the working directory so a relative path and any dot
 * segments collapse, then resolves symlinks. That last step is what makes the zoning a statement
 * about where a write lands rather than about the string it was asked with. Without it a symlink
 * inside an auto-approved directory redirects the write to wherever it points, and the containment
 * check still reads as satisfied.
 */
export function canonicalisePath(value: string, fs: IFileSystem): string {
  const absolute = path.resolve(fs.cwd(), expandPath(value, fs));
  return resolveSymlinks(absolute, fs);
}

/**
 * A path that does not exist is the ordinary case for a file about to be created, and realpath has
 * nothing to resolve against. So walk up to the deepest ancestor that does exist, resolve that, and
 * re-append the rest: a new file under a symlinked directory still resolves to its real location.
 */
function resolveSymlinks(absolute: string, fs: IFileSystem): string {
  const trailing: string[] = [];
  let current = absolute;

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      return absolute;
    }
    trailing.unshift(path.basename(current));
    current = parent;
  }

  return path.join(fs.realpathSync(current), ...trailing);
}
