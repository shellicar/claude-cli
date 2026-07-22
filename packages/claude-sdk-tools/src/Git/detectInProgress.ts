import { isAbsolute, join } from 'node:path';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';

export type InProgressOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert';

/** Resolves `<cwd>/<gitDir>` to the directory git itself would use — following the `gitdir: <path>`
 *  pointer when `.git` is a file rather than a directory, as it is inside a linked worktree. Falls
 *  back to the plain join when there is no pointer to follow (an ordinary repo, or nothing there). */
async function resolveGitDir(fs: IFileSystem, cwd: string, gitDir: string): Promise<string> {
  const gitPath = join(cwd, gitDir);
  if (!(await fs.exists(gitPath))) {
    return gitPath;
  }
  const stat = await fs.stat(gitPath);
  if (!stat.isFile()) {
    return gitPath;
  }
  const content = await fs.readFile(gitPath);
  const match = content.match(/^gitdir:\s*(.+)$/m);
  if (!match) {
    return gitPath;
  }
  const pointer = match[1].trim();
  return isAbsolute(pointer) ? pointer : join(cwd, pointer);
}

/** Which operation, if any, is currently in progress in this repo's .git dir — the same state git
 *  itself checks before honouring --continue/--abort. MERGE_HEAD is written for an in-progress
 *  merge; rebase-merge/rebase-apply for an in-progress rebase (interactive and non-interactive
 *  respectively); CHERRY_PICK_HEAD/REVERT_HEAD for a cherry-pick or revert stopped on a conflict.
 *  Resolves `.git` as a worktree pointer file first, so this matches git's own view when run from
 *  inside a linked worktree. */
export async function detectInProgress(fs: IFileSystem, cwd: string, gitDir = '.git'): Promise<InProgressOperation | null> {
  const base = await resolveGitDir(fs, cwd, gitDir);
  if (await fs.exists(join(base, 'MERGE_HEAD'))) {
    return 'merge';
  }
  if ((await fs.exists(join(base, 'rebase-merge'))) || (await fs.exists(join(base, 'rebase-apply')))) {
    return 'rebase';
  }
  if (await fs.exists(join(base, 'CHERRY_PICK_HEAD'))) {
    return 'cherry-pick';
  }
  if (await fs.exists(join(base, 'REVERT_HEAD'))) {
    return 'revert';
  }
  return null;
}
