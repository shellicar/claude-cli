import type { ToolDefinition } from '@shellicar/claude-sdk';
import type { CommandSpec, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import type { z } from 'zod';
import { GitFetchInputSchema, GitPushInputSchema, GitRebaseInputSchema, GitRebaseOntoInputSchema } from '../../src/Git/schema';
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
  // field the tool passes straight to git argv. The correct, safe behaviour is to refuse before
  // ever building argv. These currently fail against the shipped code, because nothing does that
  // — the value sails through and reaches git verbatim, which is the injection.

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

describe('createGitTools argument construction (documents the actual unsafe argv, for context)', () => {
  it('shows the injected flag reaching git argv unchanged on Git_Fetch', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_Fetch = findTool<typeof GitFetchInputSchema>(tools, 'Git_Fetch');

    await call(Git_Fetch, { remote: '--upload-pack=touch /tmp/pwned' });

    const actual = d.calls[0]?.args;
    expect(actual).toContain('--upload-pack=touch /tmp/pwned');
  });
});
