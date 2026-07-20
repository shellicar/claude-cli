import type { ToolDefinition } from '@shellicar/claude-sdk';
import type { CommandSpec, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import type { z } from 'zod';
import { GitFetchInputSchema, GitPushInputSchema, GitRebaseInputSchema, GitRebaseOntoInputSchema, GitStashApplyInputSchema } from '../../src/Git/schema';
import { createGitTools } from '../../src/Git/tools';
import { describe, expect, it } from 'vitest';
import { call } from '../helpers';
import { MemoryFileSystem } from '../MemoryFileSystem';

/** Records the argv git was actually invoked with, so a test can assert on exactly what reaches
 *  the child process — the thing git itself parses for flags vs values. */
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

function deps() {
  return { ...recordingExecutor(), fs: new MemoryFileSystem() };
}

function findTool<TSchema extends z.ZodType>(tools: ReturnType<typeof createGitTools>, name: string): ToolDefinition<TSchema, z.ZodType> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`tool not found: ${name}`);
  }
  return tool as unknown as ToolDefinition<TSchema, z.ZodType>;
}

describe('createGitTools rejects option-shaped user input (proves git argument injection)', () => {
  // Each of these feeds a value that git would parse as a flag, not a ref/remote name, into a
  // field the tool passes straight to git argv. The schema layer refuses before buildArgs ever runs.

  it('refuses an option-shaped remote on Git_Fetch instead of handing git --upload-pack=<cmd>', async () => {
    const tools = createGitTools(deps(), { enableUnrecoverable: false });
    const Git_Fetch = findTool<typeof GitFetchInputSchema>(tools, 'Git_Fetch');

    const actual = call(Git_Fetch, { remote: '--upload-pack=touch /tmp/pwned' });
    await expect(actual).rejects.toThrow();
  });

  it('refuses an option-shaped remote on Git_Push instead of handing git --receive-pack=<cmd>', async () => {
    const tools = createGitTools(deps(), { enableUnrecoverable: false });
    const Git_Push = findTool<typeof GitPushInputSchema>(tools, 'Git_Push');

    const actual = call(Git_Push, { remote: '--receive-pack=touch /tmp/pwned' });
    await expect(actual).rejects.toThrow();
  });

  it('refuses an option-shaped base on Git_Rebase instead of handing git --exec=<cmd>', async () => {
    const tools = createGitTools(deps(), { enableUnrecoverable: false });
    const Git_Rebase = findTool<typeof GitRebaseInputSchema>(tools, 'Git_Rebase');

    const actual = call(Git_Rebase, { base: '--exec=touch /tmp/pwned' });
    await expect(actual).rejects.toThrow();
  });

  it('refuses an option-shaped oldBase on Git_RebaseOnto instead of handing git --exec=<cmd>', async () => {
    const tools = createGitTools(deps(), { enableUnrecoverable: false });
    const Git_RebaseOnto = findTool<typeof GitRebaseOntoInputSchema>(tools, 'Git_RebaseOnto');

    const actual = call(Git_RebaseOnto, { oldBase: '--exec=touch /tmp/pwned', newBase: 'origin/main', branch: 'feature/x' });
    await expect(actual).rejects.toThrow();
  });
});

describe('Git_StashApply refuses on a dirty working tree (no --abort exists to undo it)', () => {
  // git status --porcelain is the first call the handler makes; a scripted executor writes to the
  // status call's own stdout stream (as a real git status --porcelain would) so the handler's dirty/
  // clean check can be driven without a real repo.
  function scriptedExecutor(statusOutput: string): { executor: IExecutor; calls: CommandSpec[] } {
    const calls: CommandSpec[] = [];
    const executor: IExecutor = {
      run: async (cmd: CommandSpec, opts?: SpawnOpts) => {
        calls.push(cmd);
        if (cmd.args?.includes('--porcelain')) {
          opts?.stdout?.write(statusOutput);
        }
        return { exitCode: 0, signal: null };
      },
    };
    return { executor, calls };
  }

  it('refuses when the working tree has uncommitted changes', async () => {
    const { executor, calls } = scriptedExecutor(' M src/index.ts\n');
    const d = { executor, fs: new MemoryFileSystem() };
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_StashApply = findTool<typeof GitStashApplyInputSchema>(tools, 'Git_StashApply');

    const actual = call(Git_StashApply, {});
    await expect(actual).rejects.toThrow(/clean/);

    const expected = 1; // only the status check ran — stash apply itself never got invoked
    expect(calls).toHaveLength(expected);
  });

  it('proceeds to stash apply when the working tree is clean', async () => {
    const { executor, calls } = scriptedExecutor('');
    const d = { executor, fs: new MemoryFileSystem() };
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_StashApply = findTool<typeof GitStashApplyInputSchema>(tools, 'Git_StashApply');

    await call(Git_StashApply, {});

    const expected = ['stash', 'apply'];
    const actual = calls[1]?.args;
    expect(actual).toEqual(expected);
  });
});

describe('createGitTools shields git argv with --end-of-options as a second layer', () => {
  // Calls tool.handler directly, bypassing input_schema.parse (which the tests above prove already
  // refuses this value) — so this proves the second, independent layer: even if the schema guard
  // were ever removed or had a gap, the same injected flag can no longer act as an option, because
  // it is preceded by --end-of-options in the argv actually handed to git.

  it('inserts --end-of-options immediately before an option-shaped remote on Git_Fetch', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_Fetch = findTool<typeof GitFetchInputSchema>(tools, 'Git_Fetch');

    await Git_Fetch.handler({ remote: '--upload-pack=touch /tmp/pwned' } as z.output<typeof GitFetchInputSchema>);

    const expected = ['fetch', '--end-of-options', '--upload-pack=touch /tmp/pwned'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });
});

