import path from 'node:path';
import { expandPath } from './expandPath';
import type { IFileSystem } from './interfaces';

// A cap on how many links deep resolution will follow, so a symlink cycle terminates rather than
// recursing forever. Well above any real chain; Linux uses 40 for the same purpose.
const MAX_LINK_DEPTH = 32;

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
  return resolve(absolute, fs, MAX_LINK_DEPTH);
}

/**
 * Resolve a path one component at a time, reading each link rather than asking whether the path
 * exists. Existence is the wrong question: a link pointing at something not yet created still
 * decides where a write lands, and an existence probe follows the link and reports false, leaving
 * the link unresolved and the write redirected. Reading the link answers regardless of its target,
 * so a path that does not exist yet resolves exactly as the file it is about to become.
 */
function resolve(target: string, fs: IFileSystem, depth: number): string {
  if (depth <= 0) {
    return target;
  }
  const parent = path.dirname(target);
  if (parent === target) {
    return target;
  }
  const resolvedParent = resolve(parent, fs, depth - 1);
  const candidate = path.join(resolvedParent, path.basename(target));
  const link = fs.readlinkSync(candidate);
  if (link == null) {
    return candidate;
  }
  return resolve(path.resolve(resolvedParent, link), fs, depth - 1);
}
