import type { CommandSpec, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import { createGitWorktreeListTool } from '../../src/Git/worktreeList';
import { call } from '../helpers';

function scriptedExecutor(stdout: string): { executor: IExecutor; calls: CommandSpec[] } {
  const calls: CommandSpec[] = [];
  const executor: IExecutor = {
    run: async (cmd: CommandSpec, opts?: SpawnOpts) => {
      calls.push(cmd);
      opts?.stdout?.write(stdout);
      return { exitCode: 0, signal: null };
    },
  };
  return { executor, calls };
}

describe('Git_WorktreeList', () => {
  it('parses the main worktree, a branch worktree, a detached one, a locked one, and a prunable one', async () => {
    const stdout = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo-feature',
      'HEAD def456',
      'branch refs/heads/feature/x',
      '',
      'worktree /repo-detached',
      'HEAD 789abc',
      'detached',
      '',
      'worktree /repo-locked',
      'HEAD 111222',
      'branch refs/heads/locked-branch',
      'locked a reason for the lock',
      '',
      'worktree /repo-prunable',
      'HEAD 333444',
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n');
    const { executor } = scriptedExecutor(stdout);
    const tool = createGitWorktreeListTool({ executor, fs: {} as never });

    const expected = [
      { path: '/repo', head: 'abc123', branch: 'main', locked: null, prunable: null },
      { path: '/repo-feature', head: 'def456', branch: 'feature/x', locked: null, prunable: null },
      { path: '/repo-detached', head: '789abc', branch: null, locked: null, prunable: null },
      { path: '/repo-locked', head: '111222', branch: 'locked-branch', locked: 'a reason for the lock', prunable: null },
      { path: '/repo-prunable', head: '333444', branch: null, locked: null, prunable: 'gitdir file points to non-existent location' },
    ];
    const actual = await call(tool, {});
    expect(actual).toEqual(expected);
  });

  it('represents a locked entry with no stated reason as an empty string, distinct from not locked at all', async () => {
    const stdout = ['worktree /repo', 'HEAD abc123', 'branch refs/heads/main', 'locked', ''].join('\n');
    const { executor } = scriptedExecutor(stdout);
    const tool = createGitWorktreeListTool({ executor, fs: {} as never });

    const expected = '';
    const actual = (await call(tool, {}))[0]?.locked;
    expect(actual).toBe(expected);
  });

  it('throws when git itself fails', async () => {
    const executor: IExecutor = { run: async () => ({ exitCode: 128, signal: null }) };
    const tool = createGitWorktreeListTool({ executor, fs: {} as never });

    const actual = call(tool, {});
    await expect(actual).rejects.toThrow();
  });
});
