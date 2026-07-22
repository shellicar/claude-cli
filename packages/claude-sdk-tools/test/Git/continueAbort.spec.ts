import type { CommandSpec, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import { createGitContinueAbortTools } from '../../src/Git/continueAbort';
import { call } from '../helpers';
import { MemoryFileSystem } from '../MemoryFileSystem';

function recordingExecutor(): { executor: IExecutor; calls: CommandSpec[] } {
  const calls: CommandSpec[] = [];
  const executor: IExecutor = {
    run: async (cmd: CommandSpec, _opts?: SpawnOpts) => {
      calls.push(cmd);
      return { exitCode: 0, signal: null };
    },
  };
  return { executor, calls };
}

describe('Git_Continue', () => {
  it('runs merge --continue when a merge is in progress', async () => {
    const { executor, calls } = recordingExecutor();
    const fs = new MemoryFileSystem({ '/repo/.git/MERGE_HEAD': 'abc123\n' });
    const [Continue] = createGitContinueAbortTools({ executor, fs });

    await call(Continue, { cwd: '/repo' });

    const expected = ['merge', '--continue'];
    const actual = calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('runs rebase --continue when a rebase is in progress', async () => {
    const { executor, calls } = recordingExecutor();
    const fs = new MemoryFileSystem({ '/repo/.git/rebase-merge': '' });
    const [Continue] = createGitContinueAbortTools({ executor, fs });

    await call(Continue, { cwd: '/repo' });

    const expected = ['rebase', '--continue'];
    const actual = calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('runs cherry-pick --continue when a cherry-pick is in progress', async () => {
    const { executor, calls } = recordingExecutor();
    const fs = new MemoryFileSystem({ '/repo/.git/CHERRY_PICK_HEAD': 'abc123\n' });
    const [Continue] = createGitContinueAbortTools({ executor, fs });

    await call(Continue, { cwd: '/repo' });

    const expected = ['cherry-pick', '--continue'];
    const actual = calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('runs revert --continue when a revert is in progress', async () => {
    const { executor, calls } = recordingExecutor();
    const fs = new MemoryFileSystem({ '/repo/.git/REVERT_HEAD': 'abc123\n' });
    const [Continue] = createGitContinueAbortTools({ executor, fs });

    await call(Continue, { cwd: '/repo' });

    const expected = ['revert', '--continue'];
    const actual = calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('refuses when nothing is in progress', async () => {
    const { executor } = recordingExecutor();
    const fs = new MemoryFileSystem({ '/repo/.git/config': '[core]\n' });
    const [Continue] = createGitContinueAbortTools({ executor, fs });

    const actual = call(Continue, { cwd: '/repo' });
    await expect(actual).rejects.toThrow(/No merge, rebase, cherry-pick, or revert/);
  });
});

describe('Git_Abort', () => {
  it('runs merge --abort when a merge is in progress', async () => {
    const { executor, calls } = recordingExecutor();
    const fs = new MemoryFileSystem({ '/repo/.git/MERGE_HEAD': 'abc123\n' });
    const [, Abort] = createGitContinueAbortTools({ executor, fs });

    await call(Abort, { cwd: '/repo' });

    const expected = ['merge', '--abort'];
    const actual = calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('runs rebase --abort when a rebase is in progress', async () => {
    const { executor, calls } = recordingExecutor();
    const fs = new MemoryFileSystem({ '/repo/.git/rebase-apply': '' });
    const [, Abort] = createGitContinueAbortTools({ executor, fs });

    await call(Abort, { cwd: '/repo' });

    const expected = ['rebase', '--abort'];
    const actual = calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('runs cherry-pick --abort when a cherry-pick is in progress', async () => {
    const { executor, calls } = recordingExecutor();
    const fs = new MemoryFileSystem({ '/repo/.git/CHERRY_PICK_HEAD': 'abc123\n' });
    const [, Abort] = createGitContinueAbortTools({ executor, fs });

    await call(Abort, { cwd: '/repo' });

    const expected = ['cherry-pick', '--abort'];
    const actual = calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('runs revert --abort when a revert is in progress', async () => {
    const { executor, calls } = recordingExecutor();
    const fs = new MemoryFileSystem({ '/repo/.git/REVERT_HEAD': 'abc123\n' });
    const [, Abort] = createGitContinueAbortTools({ executor, fs });

    await call(Abort, { cwd: '/repo' });

    const expected = ['revert', '--abort'];
    const actual = calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('refuses when nothing is in progress', async () => {
    const { executor } = recordingExecutor();
    const fs = new MemoryFileSystem({ '/repo/.git/config': '[core]\n' });
    const [, Abort] = createGitContinueAbortTools({ executor, fs });

    const actual = call(Abort, { cwd: '/repo' });
    await expect(actual).rejects.toThrow(/No merge, rebase, cherry-pick, or revert/);
  });

  it('runs abort against a linked worktree, resolving MERGE_HEAD through the gitdir pointer', async () => {
    const { executor, calls } = recordingExecutor();
    const worktreeGitDir = '/main-repo/.git/worktrees/wt';
    const fs = new MemoryFileSystem({
      [`${worktreeGitDir}/MERGE_HEAD`]: 'abc123\n',
      '/worktree/.git': `gitdir: ${worktreeGitDir}\n`,
    });
    const [, Abort] = createGitContinueAbortTools({ executor, fs });

    await call(Abort, { cwd: '/worktree' });

    const expected = ['merge', '--abort'];
    const actual = calls[0]?.args;
    expect(actual).toEqual(expected);
  });
});
