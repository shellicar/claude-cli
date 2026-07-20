import type { CommandSpec, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import { createGitBranchListTool } from '../../src/Git/branchList';
import { call } from '../helpers';
import { MemoryFileSystem } from '../MemoryFileSystem';

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

describe('Git_BranchList', () => {
  it('parses the current branch, an ordinary branch, and one checked out in another worktree into real fields', async () => {
    const stdout = ['*\tmain\t', ' \tfeature/x\t', ' \tfeature/y\t/repo-worktrees/y'].join('\n');
    const { executor } = scriptedExecutor(`${stdout}\n`);
    const tool = createGitBranchListTool({ executor, fs: new MemoryFileSystem() });

    const expected = [
      { name: 'main', current: true, worktreePath: null },
      { name: 'feature/x', current: false, worktreePath: null },
      { name: 'feature/y', current: false, worktreePath: '/repo-worktrees/y' },
    ];
    const actual = await call(tool, {});
    expect(actual).toEqual(expected);
  });

  it('passes --all through when requested', async () => {
    const { executor, calls } = scriptedExecutor('');
    const tool = createGitBranchListTool({ executor, fs: new MemoryFileSystem() });

    await call(tool, { all: true });

    const expected = true;
    const actual = calls[0]?.args?.includes('--all');
    expect(actual).toBe(expected);
  });
});
