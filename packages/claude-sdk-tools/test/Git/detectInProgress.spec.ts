import { describe, expect, it } from 'vitest';
import { detectInProgress } from '../../src/Git/detectInProgress';
import { MemoryFileSystem } from '../MemoryFileSystem';

describe('detectInProgress', () => {
  it('detects a merge in progress in an ordinary repo', async () => {
    const fs = new MemoryFileSystem({ '/repo/.git/MERGE_HEAD': 'abc123\n' });

    const actual = await detectInProgress(fs, '/repo');

    expect(actual).toBe('merge');
  });

  it('detects a merge in progress inside a linked worktree, where .git is a file pointing elsewhere', async () => {
    // Real worktree layout: the worktree's `.git` is a file with `gitdir: <path>`, and the actual
    // per-worktree state (including MERGE_HEAD) lives at that pointed-to path, not under
    // `<worktree>/.git/`.
    const worktreeGitDir = '/main-repo/.git/worktrees/wt';
    const fs = new MemoryFileSystem({
      [`${worktreeGitDir}/MERGE_HEAD`]: 'abc123\n',
      '/worktree/.git': `gitdir: ${worktreeGitDir}\n`,
    });

    const actual = await detectInProgress(fs, '/worktree');

    expect(actual).toBe('merge');
  });

  it('detects a cherry-pick in progress', async () => {
    const fs = new MemoryFileSystem({ '/repo/.git/CHERRY_PICK_HEAD': 'abc123\n' });

    const actual = await detectInProgress(fs, '/repo');

    expect(actual).toBe('cherry-pick');
  });

  it('detects a revert in progress', async () => {
    const fs = new MemoryFileSystem({ '/repo/.git/REVERT_HEAD': 'abc123\n' });

    const actual = await detectInProgress(fs, '/repo');

    expect(actual).toBe('revert');
  });

  it('returns null when nothing is in progress', async () => {
    const fs = new MemoryFileSystem({ '/repo/.git/config': '[core]\n' });

    const actual = await detectInProgress(fs, '/repo');

    expect(actual).toBeNull();
  });
});
