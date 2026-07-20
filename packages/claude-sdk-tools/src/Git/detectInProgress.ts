import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type InProgressOperation = 'merge' | 'rebase';

/** Which operation, if any, is currently in progress in this repo's .git dir — the same state git
 *  itself checks before honouring --continue/--abort. MERGE_HEAD is written for an in-progress
 *  merge; rebase-merge/rebase-apply for an in-progress rebase (interactive and non-interactive
 *  respectively). */
export function detectInProgress(cwd: string, gitDir = '.git'): InProgressOperation | null {
  const base = join(cwd, gitDir);
  if (existsSync(join(base, 'MERGE_HEAD'))) {
    return 'merge';
  }
  if (existsSync(join(base, 'rebase-merge')) || existsSync(join(base, 'rebase-apply'))) {
    return 'rebase';
  }
  return null;
}
