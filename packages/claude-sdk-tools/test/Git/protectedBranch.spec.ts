import type { CommandSpec, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import { assertNotDefaultBranch, resolveDefaultBranch } from '../../src/Git/protectedBranch';

function scriptedExecutor(responses: Record<string, string>): IExecutor {
  return {
    run: async (cmd: CommandSpec, opts?: SpawnOpts) => {
      const key = cmd.args?.join(' ') ?? '';
      const output = responses[key];
      if (output != null) {
        opts?.stdout?.write(output);
        return { exitCode: 0, signal: null };
      }
      return { exitCode: 1, signal: null };
    },
  };
}

describe('resolveDefaultBranch', () => {
  it('reads the default branch name from origin/HEAD', async () => {
    const executor = scriptedExecutor({ 'symbolic-ref refs/remotes/origin/HEAD': 'refs/remotes/origin/main\n' });
    const deps = { executor, fs: {} as never };

    const expected = 'main';
    const actual = await resolveDefaultBranch(deps, '/repo');
    expect(actual).toBe(expected);
  });

  it('returns null when there is no origin/HEAD pointer to read', async () => {
    const executor = scriptedExecutor({});
    const deps = { executor, fs: {} as never };

    const expected = null;
    const actual = await resolveDefaultBranch(deps, '/repo');
    expect(actual).toBe(expected);
  });
});

describe('assertNotDefaultBranch', () => {
  it('throws when the target branch is the default branch', async () => {
    const executor = scriptedExecutor({ 'symbolic-ref refs/remotes/origin/HEAD': 'refs/remotes/origin/main\n' });
    const deps = { executor, fs: {} as never };

    const actual = assertNotDefaultBranch(deps, '/repo', 'main', 'Git_ForcePushWithLease');
    await expect(actual).rejects.toThrow(/default branch/);
  });

  it('does not throw for a non-default branch', async () => {
    const executor = scriptedExecutor({ 'symbolic-ref refs/remotes/origin/HEAD': 'refs/remotes/origin/main\n' });
    const deps = { executor, fs: {} as never };

    const actual = assertNotDefaultBranch(deps, '/repo', 'feature/x', 'Git_ForcePushWithLease');
    await expect(actual).resolves.toBeUndefined();
  });

  it('falls back to the currently checked-out branch when no target is given', async () => {
    const executor = scriptedExecutor({
      'symbolic-ref refs/remotes/origin/HEAD': 'refs/remotes/origin/main\n',
      'rev-parse --abbrev-ref HEAD': 'main\n',
    });
    const deps = { executor, fs: {} as never };

    const actual = assertNotDefaultBranch(deps, '/repo', null, 'Git_Rebase');
    await expect(actual).rejects.toThrow(/default branch/);
  });

  it('does not throw when the default branch cannot be resolved (fails open)', async () => {
    const executor = scriptedExecutor({});
    const deps = { executor, fs: {} as never };

    const actual = assertNotDefaultBranch(deps, '/repo', 'main', 'Git_ForcePushWithLease');
    await expect(actual).resolves.toBeUndefined();
  });
});
