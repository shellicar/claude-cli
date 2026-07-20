import type { CommandSpec, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import { runGitText } from '../../src/Git/runGit';
import { MemoryFileSystem } from '../MemoryFileSystem';

function scriptedExecutor(exitCode: number, stdout: string, stderr: string): IExecutor {
  return {
    run: async (_cmd: CommandSpec, opts?: SpawnOpts) => {
      opts?.stdout?.write(stdout);
      opts?.stderr?.write(stderr);
      return { exitCode, signal: null };
    },
  };
}

describe('runGitText', () => {
  it('returns stdout alone when stderr is empty', async () => {
    const deps = { executor: scriptedExecutor(0, 'On branch main\n', ''), fs: new MemoryFileSystem() };

    const expected = 'On branch main';
    const actual = await runGitText(deps, ['status'], '/repo');
    expect(actual).toBe(expected);
  });

  it('merges stderr in on success, since git often writes real content there (e.g. switch)', async () => {
    const deps = { executor: scriptedExecutor(0, '', "Switched to branch 'feature/x'\n"), fs: new MemoryFileSystem() };

    const expected = "Switched to branch 'feature/x'";
    const actual = await runGitText(deps, ['switch', 'feature/x'], '/repo');
    expect(actual).toBe(expected);
  });

  it('merges both streams when both are present', async () => {
    const deps = { executor: scriptedExecutor(0, 'stdout line\n', 'stderr line\n'), fs: new MemoryFileSystem() };

    const expected = 'stdout line\nstderr line';
    const actual = await runGitText(deps, ['fetch'], '/repo');
    expect(actual).toBe(expected);
  });

  it('throws on a non-zero exit instead of returning it as data', async () => {
    const deps = { executor: scriptedExecutor(1, '', 'fatal: not a git repository\n'), fs: new MemoryFileSystem() };

    const actual = runGitText(deps, ['status'], '/repo');
    await expect(actual).rejects.toThrow('fatal: not a git repository');
  });

  it('throws a fallback message when a failing command produced no output at all', async () => {
    const deps = { executor: scriptedExecutor(1, '', ''), fs: new MemoryFileSystem() };

    const actual = runGitText(deps, ['status'], '/repo');
    await expect(actual).rejects.toThrow(/exit code 1/);
  });
});
