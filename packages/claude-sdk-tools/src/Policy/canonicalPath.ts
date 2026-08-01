import { basename, dirname, join } from 'node:path';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';

/**
 * The path as the kernel will understand it, with every symlink resolved.
 *
 * A decision has to be about the object the operation will act on, and the kernel's notion of that
 * object is the resolved one: permissions on a symlink are ignored, `open()` walks the link and
 * checks the target. So `$PWD/link/id_rsa`, where `link` points at `~/.ssh`, is a read of
 * `~/.ssh/id_rsa` however it was spelled, and a rule scoped to the project has to see that.
 *
 * A path that does not exist yet is the ordinary case for a write, so the nearest existing ancestor
 * is resolved and the rest is kept as written: the directory being written into is real, and that
 * is where a link would be.
 *
 * This does not close the gap between deciding and acting — the link can be replaced in between,
 * and only the OS can prevent that. It makes the decision correct about the object as it stands.
 */
export async function canonicalPath(fs: IFileSystem, path: string): Promise<string> {
  try {
    return await fs.realpath(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) {
      return path;
    }
    return join(await canonicalPath(fs, parent), basename(path));
  }
}
