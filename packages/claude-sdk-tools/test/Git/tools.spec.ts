import type { ToolDefinition } from '@shellicar/claude-sdk';
import type { CommandSpec, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type {
  GitAmendCommitInputSchema,
  GitCherryPickInputSchema,
  GitCloneInputSchema,
  GitConfigInputSchema,
  GitDeleteBranchForceInputSchema,
  GitDescribeInputSchema,
  GitFetchInputSchema,
  GitForcePushWithLeaseInputSchema,
  GitGrepInputSchema,
  GitInitInputSchema,
  GitLsFilesInputSchema,
  GitMergeBaseInputSchema,
  GitMergeInputSchema,
  GitMoveInputSchema,
  GitPushInputSchema,
  GitRebaseInputSchema,
  GitRebaseOntoInputSchema,
  GitReflogInputSchema,
  GitRevertInputSchema,
  GitStashApplyInputSchema,
  GitSubmoduleAddInputSchema,
  GitSubmoduleDeinitInputSchema,
  GitSubmoduleStatusInputSchema,
  GitSubmoduleUpdateInputSchema,
  GitWorktreeAddInputSchema,
  GitWorktreePruneInputSchema,
  GitWorktreeRemoveInputSchema,
} from '../../src/Git/schema';
import { createGitTools } from '../../src/Git/tools';
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

    const actual = call(Git_Rebase, { intent: 'test', base: '--exec=touch /tmp/pwned' });
    await expect(actual).rejects.toThrow();
  });

  it('refuses an option-shaped oldBase on Git_RebaseOnto instead of handing git --exec=<cmd>', async () => {
    const tools = createGitTools(deps(), { enableUnrecoverable: false });
    const Git_RebaseOnto = findTool<typeof GitRebaseOntoInputSchema>(tools, 'Git_RebaseOnto');

    const actual = call(Git_RebaseOnto, { intent: 'test', oldBase: '--exec=touch /tmp/pwned', newBase: 'origin/main', branch: 'feature/x' });
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

    const actual = call(Git_StashApply, { intent: 'test' });
    await expect(actual).rejects.toThrow(/clean/);

    const expected = 1; // only the status check ran — stash apply itself never got invoked
    expect(calls).toHaveLength(expected);
  });

  it('proceeds to stash apply when the working tree is clean', async () => {
    const { executor, calls } = scriptedExecutor('');
    const d = { executor, fs: new MemoryFileSystem() };
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_StashApply = findTool<typeof GitStashApplyInputSchema>(tools, 'Git_StashApply');

    await call(Git_StashApply, { intent: 'test' });

    const expected = ['stash', 'apply'];
    const actual = calls[1]?.args;
    expect(actual).toEqual(expected);
  });
});

describe('protectDefaultBranch refuses reflog-tier tools that target the default branch', () => {
  // origin/HEAD resolves to 'main' in every case here; rev-parse --abbrev-ref HEAD backs the tools
  // that fall back to the checked-out branch (Git_AmendCommit, Git_Rebase) when no target field
  // is given.
  function defaultBranchExecutor(currentBranch: string): { executor: IExecutor; calls: CommandSpec[] } {
    const calls: CommandSpec[] = [];
    const executor: IExecutor = {
      run: async (cmd: CommandSpec, opts?: SpawnOpts) => {
        calls.push(cmd);
        if (cmd.args?.join(' ') === 'symbolic-ref refs/remotes/origin/HEAD') {
          opts?.stdout?.write('refs/remotes/origin/main\n');
        } else if (cmd.args?.join(' ') === 'rev-parse --abbrev-ref HEAD') {
          opts?.stdout?.write(`${currentBranch}\n`);
        }
        return { exitCode: 0, signal: null };
      },
    };
    return { executor, calls };
  }

  it('refuses Git_ForcePushWithLease targeting main', async () => {
    const { executor } = defaultBranchExecutor('main');
    const tools = createGitTools({ executor, fs: new MemoryFileSystem() }, { enableUnrecoverable: false });
    const Git_ForcePushWithLease = findTool<typeof GitForcePushWithLeaseInputSchema>(tools, 'Git_ForcePushWithLease');

    const actual = call(Git_ForcePushWithLease, { intent: 'test', branch: 'main' });
    await expect(actual).rejects.toThrow(/default branch/);
  });

  it('refuses Git_DeleteBranchForce targeting main', async () => {
    const { executor } = defaultBranchExecutor('main');
    const tools = createGitTools({ executor, fs: new MemoryFileSystem() }, { enableUnrecoverable: false });
    const Git_DeleteBranchForce = findTool<typeof GitDeleteBranchForceInputSchema>(tools, 'Git_DeleteBranchForce');

    const actual = call(Git_DeleteBranchForce, { intent: 'test', name: 'main' });
    await expect(actual).rejects.toThrow(/default branch/);
  });

  it('refuses Git_Rebase when main is the checked-out branch', async () => {
    const { executor } = defaultBranchExecutor('main');
    const tools = createGitTools({ executor, fs: new MemoryFileSystem() }, { enableUnrecoverable: false });
    const Git_Rebase = findTool<typeof GitRebaseInputSchema>(tools, 'Git_Rebase');

    const actual = call(Git_Rebase, { intent: 'test', base: 'origin/main' });
    await expect(actual).rejects.toThrow(/default branch/);
  });

  it('refuses Git_AmendCommit when main is the checked-out branch', async () => {
    const { executor } = defaultBranchExecutor('main');
    const tools = createGitTools({ executor, fs: new MemoryFileSystem() }, { enableUnrecoverable: false });
    const Git_AmendCommit = findTool<typeof GitAmendCommitInputSchema>(tools, 'Git_AmendCommit');

    const actual = call(Git_AmendCommit, { intent: 'test' });
    await expect(actual).rejects.toThrow(/default branch/);
  });

  it('allows Git_Rebase on a feature branch', async () => {
    const { executor } = defaultBranchExecutor('feature/x');
    const tools = createGitTools({ executor, fs: new MemoryFileSystem() }, { enableUnrecoverable: false });
    const Git_Rebase = findTool<typeof GitRebaseInputSchema>(tools, 'Git_Rebase');

    const actual = call(Git_Rebase, { intent: 'test', base: 'origin/main' });
    await expect(actual).resolves.toBeDefined();
  });

  it('allows a normally-refused call when protectDefaultBranch is disabled', async () => {
    const { executor } = defaultBranchExecutor('main');
    const tools = createGitTools({ executor, fs: new MemoryFileSystem() }, { enableUnrecoverable: false, protectDefaultBranch: false });
    const Git_DeleteBranchForce = findTool<typeof GitDeleteBranchForceInputSchema>(tools, 'Git_DeleteBranchForce');

    const actual = call(Git_DeleteBranchForce, { intent: 'test', name: 'main' });
    await expect(actual).resolves.toBeDefined();
  });
});

describe('the new read-only ancestry/config tools build the argv the SC asked for', () => {
  it('Git_Reflog defaults to reflog show, applying -n and the ref when given', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_Reflog = findTool<typeof GitReflogInputSchema>(tools, 'Git_Reflog');

    await call(Git_Reflog, { intent: 'test', maxCount: 5, ref: 'feature/x' });

    const expected = ['reflog', 'show', '-n', '5', '--end-of-options', 'feature/x'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_MergeBase passes both refs after a single --end-of-options', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_MergeBase = findTool<typeof GitMergeBaseInputSchema>(tools, 'Git_MergeBase');

    await call(Git_MergeBase, { intent: 'test', refA: 'HEAD', refB: 'origin/main' });

    const expected = ['merge-base', '--end-of-options', 'HEAD', 'origin/main'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_Describe applies --tags and the ref when given', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_Describe = findTool<typeof GitDescribeInputSchema>(tools, 'Git_Describe');

    await call(Git_Describe, { intent: 'test', tags: true, ref: 'HEAD' });

    const expected = ['describe', '--tags', '--end-of-options', 'HEAD'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_Config lists everything when no key is given', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_Config = findTool<typeof GitConfigInputSchema>(tools, 'Git_Config');

    await call(Git_Config, { intent: 'test' });

    const expected = ['config', '--list'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_Config reads a single key when given', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_Config = findTool<typeof GitConfigInputSchema>(tools, 'Git_Config');

    await call(Git_Config, { intent: 'test', key: 'user.email' });

    const expected = ['config', '--get', '--end-of-options', 'user.email'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_LsFiles scopes to a path behind -- when given', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_LsFiles = findTool<typeof GitLsFilesInputSchema>(tools, 'Git_LsFiles');

    await call(Git_LsFiles, { intent: 'test', path: 'src' });

    const expected = ['ls-files', '--', 'src'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('refuses an option-shaped key on Git_Config instead of handing git an arbitrary flag', async () => {
    const tools = createGitTools(deps(), { enableUnrecoverable: false });
    const Git_Config = findTool<typeof GitConfigInputSchema>(tools, 'Git_Config');

    const actual = call(Git_Config, { intent: 'test', key: '--file=/etc/passwd' });
    await expect(actual).rejects.toThrow();
  });
});

describe('the new worktree tools build the argv the SC asked for (no force on add/remove)', () => {
  it('Git_WorktreeAdd checks out an existing branch when no newBranch is given', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_WorktreeAdd = findTool<typeof GitWorktreeAddInputSchema>(tools, 'Git_WorktreeAdd');

    await call(Git_WorktreeAdd, { path: '../repo-feature-x', branch: 'feature/x' });

    const expected = ['worktree', 'add', '--end-of-options', '../repo-feature-x', 'feature/x'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_WorktreeAdd creates a new branch with -b when newBranch is given', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_WorktreeAdd = findTool<typeof GitWorktreeAddInputSchema>(tools, 'Git_WorktreeAdd');

    await call(Git_WorktreeAdd, { path: '../repo-feature-x', newBranch: 'feature/x' });

    const expected = ['worktree', 'add', '-b', 'feature/x', '--end-of-options', '../repo-feature-x'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_WorktreePrune applies --dry-run when requested', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_WorktreePrune = findTool<typeof GitWorktreePruneInputSchema>(tools, 'Git_WorktreePrune');

    await call(Git_WorktreePrune, { dryRun: true });

    const expected = ['worktree', 'prune', '--dry-run'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_WorktreePrune runs plainly when dryRun is omitted', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_WorktreePrune = findTool<typeof GitWorktreePruneInputSchema>(tools, 'Git_WorktreePrune');

    await call(Git_WorktreePrune, {});

    const expected = ['worktree', 'prune'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_WorktreeRemove has no force flag to expose', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_WorktreeRemove = findTool<typeof GitWorktreeRemoveInputSchema>(tools, 'Git_WorktreeRemove');

    await call(Git_WorktreeRemove, { path: '../repo-feature-x' });

    const expected = ['worktree', 'remove', '--end-of-options', '../repo-feature-x'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('refuses an option-shaped path on Git_WorktreeAdd instead of handing git an arbitrary flag', async () => {
    const tools = createGitTools(deps(), { enableUnrecoverable: false });
    const Git_WorktreeAdd = findTool<typeof GitWorktreeAddInputSchema>(tools, 'Git_WorktreeAdd');

    const actual = call(Git_WorktreeAdd, { path: '--upload-pack=touch /tmp/pwned' });
    await expect(actual).rejects.toThrow();
  });

  it('refuses an option-shaped path on Git_WorktreeRemove instead of handing git an arbitrary flag', async () => {
    const tools = createGitTools(deps(), { enableUnrecoverable: false });
    const Git_WorktreeRemove = findTool<typeof GitWorktreeRemoveInputSchema>(tools, 'Git_WorktreeRemove');

    const actual = call(Git_WorktreeRemove, { path: '--force' });
    await expect(actual).rejects.toThrow();
  });
});

describe('the new merge/cherry-pick/revert/clone/grep/init/mv/submodule tools build the argv the SC asked for', () => {
  it('Git_Merge merges the given branch', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_Merge = findTool<typeof GitMergeInputSchema>(tools, 'Git_Merge');

    await call(Git_Merge, { branch: 'origin/main' });

    const expected = ['merge', '--end-of-options', 'origin/main'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_CherryPick applies the given commit', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_CherryPick = findTool<typeof GitCherryPickInputSchema>(tools, 'Git_CherryPick');

    await call(Git_CherryPick, { commit: 'abc1234' });

    const expected = ['cherry-pick', '--end-of-options', 'abc1234'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_Revert reverts the given commit without opening an editor', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_Revert = findTool<typeof GitRevertInputSchema>(tools, 'Git_Revert');

    await call(Git_Revert, { commit: 'abc1234' });

    const expected = ['revert', '--no-edit', '--end-of-options', 'abc1234'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_Clone passes the target path when given', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_Clone = findTool<typeof GitCloneInputSchema>(tools, 'Git_Clone');

    await call(Git_Clone, { url: 'https://github.com/shellicar/claude-cli.git', path: 'my-clone' });

    const expected = ['clone', '--end-of-options', 'https://github.com/shellicar/claude-cli.git', 'my-clone'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_Grep always marks the pattern with -e, so a leading dash can never be read as a flag', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_Grep = findTool<typeof GitGrepInputSchema>(tools, 'Git_Grep');

    await call(Git_Grep, { intent: 'test', pattern: '--recurse-submodules', ref: 'HEAD~5' });

    const expected = ['grep', '-e', '--recurse-submodules', '--end-of-options', 'HEAD~5'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_Init passes the target path when given', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_Init = findTool<typeof GitInitInputSchema>(tools, 'Git_Init');

    await call(Git_Init, { path: 'new-project' });

    const expected = ['init', '--end-of-options', 'new-project'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_Move passes source and dest behind --', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_Move = findTool<typeof GitMoveInputSchema>(tools, 'Git_Move');

    await call(Git_Move, { source: 'old.ts', dest: 'new.ts' });

    const expected = ['mv', '--', 'old.ts', 'new.ts'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_SubmoduleAdd passes the target path when given', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_SubmoduleAdd = findTool<typeof GitSubmoduleAddInputSchema>(tools, 'Git_SubmoduleAdd');

    await call(Git_SubmoduleAdd, { url: 'https://github.com/shellicar/some-lib.git', path: 'vendor/some-lib' });

    const expected = ['submodule', 'add', '--end-of-options', 'https://github.com/shellicar/some-lib.git', 'vendor/some-lib'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_SubmoduleStatus scopes to a path when given', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_SubmoduleStatus = findTool<typeof GitSubmoduleStatusInputSchema>(tools, 'Git_SubmoduleStatus');

    await call(Git_SubmoduleStatus, { path: 'vendor/some-lib' });

    const expected = ['submodule', 'status', '--', 'vendor/some-lib'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_SubmoduleUpdate applies --init and --recursive when requested, with no force flag to expose', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_SubmoduleUpdate = findTool<typeof GitSubmoduleUpdateInputSchema>(tools, 'Git_SubmoduleUpdate');

    await call(Git_SubmoduleUpdate, { init: true, recursive: true });

    const expected = ['submodule', 'update', '--init', '--recursive'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('Git_SubmoduleDeinit has no force flag to expose', async () => {
    const d = deps();
    const tools = createGitTools(d, { enableUnrecoverable: false });
    const Git_SubmoduleDeinit = findTool<typeof GitSubmoduleDeinitInputSchema>(tools, 'Git_SubmoduleDeinit');

    await call(Git_SubmoduleDeinit, { path: 'vendor/some-lib' });

    const expected = ['submodule', 'deinit', '--end-of-options', 'vendor/some-lib'];
    const actual = d.calls[0]?.args;
    expect(actual).toEqual(expected);
  });

  it('refuses an option-shaped branch on Git_Merge instead of handing git an arbitrary flag', async () => {
    const tools = createGitTools(deps(), { enableUnrecoverable: false });
    const Git_Merge = findTool<typeof GitMergeInputSchema>(tools, 'Git_Merge');

    const actual = call(Git_Merge, { branch: '--upload-pack=touch /tmp/pwned' });
    await expect(actual).rejects.toThrow();
  });

  it('refuses an option-shaped path on Git_SubmoduleDeinit instead of handing git an arbitrary flag', async () => {
    const tools = createGitTools(deps(), { enableUnrecoverable: false });
    const Git_SubmoduleDeinit = findTool<typeof GitSubmoduleDeinitInputSchema>(tools, 'Git_SubmoduleDeinit');

    const actual = call(Git_SubmoduleDeinit, { path: '--force' });
    await expect(actual).rejects.toThrow();
  });
});

describe('Git_Config scrubs credential-bearing values before returning them', () => {
  // git config --list routinely surfaces secrets nothing else in this tool ever sees: a remote URL
  // with embedded userinfo, an http.<url>.extraheader carrying a bearer token, a credential helper
  // line. Git_Config is Read tier (auto-approved by default), so these values would reach the model
  // and conversation history with no confirmation step at all. These tests spec the fix: whatever
  // Git_Config returns must have known-sensitive values redacted, not passed through verbatim.
  function configExecutor(configOutput: string): { executor: IExecutor; calls: CommandSpec[] } {
    const calls: CommandSpec[] = [];
    const executor: IExecutor = {
      run: async (cmd: CommandSpec, opts?: SpawnOpts) => {
        calls.push(cmd);
        opts?.stdout?.write(configOutput);
        return { exitCode: 0, signal: null };
      },
    };
    return { executor, calls };
  }

  it('redacts a token embedded in a remote URL', async () => {
    const { executor } = configExecutor('remote.origin.url=https://x-access-token:ghp_secrettoken1234567890@github.com/org/repo.git\n');
    const tools = createGitTools({ executor, fs: new MemoryFileSystem() }, { enableUnrecoverable: false });
    const Git_Config = findTool<typeof GitConfigInputSchema>(tools, 'Git_Config');

    const expected = 'remote.origin.url=https://***@github.com/org/repo.git';
    const actual = await call(Git_Config, { intent: 'test' });
    expect(actual).toBe(expected);
  });

  it('redacts an http.extraheader bearer token', async () => {
    const { executor } = configExecutor('http.https://github.com/.extraheader=AUTHORIZATION: basic dGVzdHRva2VuMTIzNDU2\n');
    const tools = createGitTools({ executor, fs: new MemoryFileSystem() }, { enableUnrecoverable: false });
    const Git_Config = findTool<typeof GitConfigInputSchema>(tools, 'Git_Config');

    const expected = 'http.https://github.com/.extraheader=***REDACTED***';
    const actual = await call(Git_Config, { intent: 'test' });
    expect(actual).toBe(expected);
  });

  it('leaves ordinary, non-sensitive config values untouched', async () => {
    const { executor } = configExecutor('user.email=dev@example.com\n');
    const tools = createGitTools({ executor, fs: new MemoryFileSystem() }, { enableUnrecoverable: false });
    const Git_Config = findTool<typeof GitConfigInputSchema>(tools, 'Git_Config');

    const expected = 'user.email=dev@example.com';
    const actual = await call(Git_Config, { intent: 'test' });
    expect(actual).toBe(expected);
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
