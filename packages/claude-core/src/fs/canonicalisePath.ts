import path from 'node:path';
import { expandPath } from './expandPath';
import type { IFileSystem } from './interfaces';

// Only ever spent following a link the OS could not follow for us, which is a link whose target does
// not exist. Path depth never touches it: a deep directory is not a traversal.
const MAX_DANGLING_HOPS = 32;

/**
 * Canonicalise a marked tool path to the single absolute form every consumer reads.
 *
 * Expands `~` and `$VAR`, resolves against the working directory so a relative path and any dot
 * segments collapse, then resolves symlinks, so the answer says where a path lands rather than how
 * it was written. Throws when the path cannot be canonicalised at all, carrying the OS's own reason:
 * a caller that needs a verdict rather than a path decides what to make of that, and a caller that
 * needs a path is better told than handed something that only looks like one.
 */
export function canonicalisePath(value: string, fs: IFileSystem): string {
  const absolute = path.resolve(fs.cwd(), expandPath(value, fs));
  return resolve(absolute, fs, MAX_DANGLING_HOPS);
}

/**
 * Resolution is the OS's job wherever the OS can do it. Walk up to the deepest component that is
 * actually there, hand that to realpath, and re-append the rest: the kernel follows every link above
 * it and enforces its own traversal limit, so neither is reimplemented here.
 *
 * The one case it cannot do is a link whose target does not exist, where realpath has nothing to
 * resolve and reports ENOENT. That link is still a live write path, so it is followed by hand, one
 * hop at a time, until it reaches somewhere real or runs out of hops.
 */
function resolve(absolute: string, fs: IFileSystem, hops: number): string {
  const trailing: string[] = [];
  let current = absolute;

  while (!fs.existsNoFollowSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      return absolute;
    }
    trailing.unshift(path.basename(current));
    current = parent;
  }

  const link = fs.readlinkSync(current);
  if (link == null) {
    return path.join(fs.realpathSync(current), ...trailing);
  }

  try {
    return path.join(fs.realpathSync(current), ...trailing);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
    if (hops <= 0) {
      const loop = new Error(`ELOOP: too many symbolic links encountered, resolving '${absolute}'`) as NodeJS.ErrnoException;
      loop.code = 'ELOOP';
      throw loop;
    }
    return path.join(resolve(path.resolve(path.dirname(current), link), fs, hops - 1), ...trailing);
  }
}
