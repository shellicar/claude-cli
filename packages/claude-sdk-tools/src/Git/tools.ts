import { ToolOperation } from '@shellicar/claude-sdk';
import { createGitBranchListTool } from './branchList';
import { createGitContinueAbortTools } from './continueAbort';
import { createGitTool } from './createGitTool';
import { assertNotDefaultBranch } from './protectedBranch';
import { redactConfigListOutput, redactConfigValue, redactUserinfo } from './redact';
import type { GitDeps } from './runGit';
import {
  GitAddInputSchema,
  GitAmendCommitInputSchema,
  GitBlameInputSchema,
  GitCommitInputSchema,
  GitConfigInputSchema,
  GitCreateBranchInputSchema,
  GitDeleteBranchForceInputSchema,
  GitDescribeInputSchema,
  GitDiffInputSchema,
  GitDiscardAllChangesInputSchema,
  GitDiscardFileChangesInputSchema,
  GitFetchInputSchema,
  GitForcePushWithLeaseInputSchema,
  GitForceRemoveFileInputSchema,
  GitLogInputSchema,
  GitLsFilesInputSchema,
  GitMergeBaseInputSchema,
  GitPullInputSchema,
  GitPushInputSchema,
  GitRebaseInputSchema,
  GitRebaseOntoInputSchema,
  GitReflogInputSchema,
  GitRemoteListInputSchema,
  GitRemoveCachedFileInputSchema,
  GitRemoveFileInputSchema,
  GitShowInputSchema,
  GitStashDropInputSchema,
  GitStashListInputSchema,
  GitStashSaveInputSchema,
  GitStatusInputSchema,
  GitSwitchBranchInputSchema,
  GitTagListInputSchema,
  GitUnstageFileInputSchema,
} from './schema';
import { createGitStashApplyTool } from './stashApply';

/** Every action the SC decided is worth building, gated by the tier it was designed into.
 *  `enableUnrecoverable` mirrors Az's presence-based gating: the unrecoverable-tier tools are not
 *  registered at all unless explicitly turned on, same as an account with no configured identity
 *  simply doesn't produce a tool. `continue`/`abort` come from `createGitContinueAbortTools` instead
 *  of `createGitTool`: which git subcommand they run depends on runtime state, not the input schema.
 *  `protectDefaultBranch` (on by default) refuses the reflog-tier tools that can rewrite a *branch*
 *  (not just local history) when that branch is the repo's default — see protectedBranch.ts for why
 *  reflog-recoverability stops holding once other clones may depend on the target. */
export function createGitTools(deps: GitDeps, options: { enableUnrecoverable: boolean; protectDefaultBranch?: boolean }) {
  const protectDefaultBranch = options.protectDefaultBranch ?? true;
  const defaultBranchGuard = (targetBranch: string | null, toolName: string) => (protectDefaultBranch ? (_input: unknown, guardDeps: GitDeps, cwd: string) => assertNotDefaultBranch(guardDeps, cwd, targetBranch, toolName) : undefined);

  const tools = [
    ...createGitContinueAbortTools(deps),
    createGitStashApplyTool(deps),

    // read-only
    createGitTool({ name: 'Git_Status', operation: ToolOperation.Read, description: 'Show the working tree status.', input_schema: GitStatusInputSchema, input_examples: [{}], buildArgs: () => ['status'] }, deps),
    createGitTool(
      {
        name: 'Git_Diff',
        operation: ToolOperation.Read,
        description: 'Show changes between commits, the working tree, and the index.',
        input_schema: GitDiffInputSchema,
        input_examples: [{ intent: 'see what changed before committing' }],
        buildArgs: (input) => {
          const args = ['diff'];
          if (input.staged) {
            args.push('--staged');
          }
          if (input.ref != null) {
            args.push('--end-of-options', input.ref);
          }
          if (input.path != null) {
            args.push('--', input.path);
          }
          return args;
        },
      },
      deps,
    ),
    createGitTool(
      {
        name: 'Git_Log',
        operation: ToolOperation.Read,
        description: 'Show commit history.',
        input_schema: GitLogInputSchema,
        input_examples: [{ intent: 'find when a regression was introduced' }],
        buildArgs: (input) => {
          const args = ['log'];
          if (input.maxCount != null) {
            args.push('-n', String(input.maxCount));
          }
          if (input.ref != null) {
            args.push('--end-of-options', input.ref);
          }
          if (input.path != null) {
            args.push('--', input.path);
          }
          return args;
        },
      },
      deps,
    ),
    createGitTool({ name: 'Git_Show', operation: ToolOperation.Read, description: 'Show a commit, tag, or other git object.', input_schema: GitShowInputSchema, input_examples: [{ intent: 'confirm the last commit landed as expected', ref: 'HEAD' }], buildArgs: (input) => ['show', '--end-of-options', input.ref] }, deps),
    createGitTool(
      {
        name: 'Git_Blame',
        operation: ToolOperation.Read,
        description: 'Show what revision and author last modified each line of a file.',
        input_schema: GitBlameInputSchema,
        input_examples: [{ intent: 'find who last touched this line and why', path: 'src/index.ts' }],
        buildArgs: (input) => {
          const args = ['blame'];
          if (input.ref != null) {
            args.push('--end-of-options', input.ref);
          }
          args.push('--', input.path);
          return args;
        },
      },
      deps,
    ),
    createGitBranchListTool(deps),
    createGitTool({ name: 'Git_TagList', operation: ToolOperation.Read, description: 'List tags.', input_schema: GitTagListInputSchema, input_examples: [{}], buildArgs: () => ['tag'] }, deps),
    createGitTool({ name: 'Git_RemoteList', operation: ToolOperation.Read, description: 'List configured remotes.', input_schema: GitRemoteListInputSchema, input_examples: [{}], buildArgs: () => ['remote', '-v'], postProcess: redactUserinfo }, deps),
    createGitTool({ name: 'Git_StashList', operation: ToolOperation.Read, description: 'List stash entries.', input_schema: GitStashListInputSchema, input_examples: [{}], buildArgs: () => ['stash', 'list'] }, deps),
    createGitTool(
      {
        name: 'Git_Reflog',
        operation: ToolOperation.Read,
        description: "Show the reflog — every position HEAD (or another ref) has pointed at, including commits no longer reachable from any branch. This is the actual recovery path after a reflog-tier operation (rebase, amend, branch -D, stash drop): a commit that looks lost is usually still here.",
        input_schema: GitReflogInputSchema,
        input_examples: [{ intent: 'find the commit that got orphaned by the rebase' }],
        buildArgs: (input) => {
          const args = ['reflog', 'show'];
          if (input.maxCount != null) {
            args.push('-n', String(input.maxCount));
          }
          if (input.ref != null) {
            args.push('--end-of-options', input.ref);
          }
          return args;
        },
      },
      deps,
    ),
    createGitTool(
      {
        name: 'Git_MergeBase',
        operation: ToolOperation.Read,
        description: 'Find the common ancestor of two refs — the actual check for whether a branch has diverged from another, not just what changed.',
        input_schema: GitMergeBaseInputSchema,
        input_examples: [{ intent: 'check how far this branch has diverged from main', refA: 'HEAD', refB: 'origin/main' }],
        buildArgs: (input) => ['merge-base', '--end-of-options', input.refA, input.refB],
      },
      deps,
    ),
    createGitTool(
      {
        name: 'Git_Describe',
        operation: ToolOperation.Read,
        description: 'Describe a ref in human-readable form relative to the nearest tag (e.g. v1.2.0-3-gabc1234).',
        input_schema: GitDescribeInputSchema,
        input_examples: [{ intent: 'find which release this commit shipped in' }],
        buildArgs: (input) => {
          const args = ['describe'];
          if (input.tags) {
            args.push('--tags');
          }
          if (input.ref != null) {
            args.push('--end-of-options', input.ref);
          }
          return args;
        },
      },
      deps,
    ),
    createGitTool(
      {
        name: 'Git_Config',
        operation: ToolOperation.Read,
        description: "Read the repo's effective git config, or one specific key.",
        input_schema: GitConfigInputSchema,
        input_examples: [{ intent: 'confirm which remote a push will actually go to' }],
        buildArgs: (input) => (input.key != null ? ['config', '--get', '--end-of-options', input.key] : ['config', '--list']),
        // A credential-bearing key's value is redacted outright; every other value only has embedded
        // URL userinfo masked. --list's output is `key=value` per line and needs the per-line form;
        // --get's output is a bare value for the one key already known from input.key.
        postProcess: (text, input) => (input.key != null ? redactConfigValue(input.key, text) : redactConfigListOutput(text)),
      },
      deps,
    ),
    createGitTool(
      {
        name: 'Git_LsFiles',
        operation: ToolOperation.Read,
        description: 'List tracked files — respects .gitignore and the index, unlike a plain filesystem walk.',
        input_schema: GitLsFilesInputSchema,
        input_examples: [{ intent: 'confirm a generated file is actually gitignored, not just untracked by accident' }],
        buildArgs: (input) => (input.path != null ? ['ls-files', '--', input.path] : ['ls-files']),
      },
      deps,
    ),

    // safe
    createGitTool({ name: 'Git_Add', operation: ToolOperation.Write, description: 'Stage paths for the next commit.', input_schema: GitAddInputSchema, input_examples: [{ paths: ['src/index.ts'] }], buildArgs: (input) => ['add', '--', ...input.paths] }, deps),
    createGitTool({ name: 'Git_UnstageFile', operation: ToolOperation.Write, description: 'Unstage paths, leaving the working tree untouched.', input_schema: GitUnstageFileInputSchema, input_examples: [{ paths: ['src/index.ts'] }], buildArgs: (input) => ['restore', '--staged', '--', ...input.paths] }, deps),
    createGitTool(
      {
        name: 'Git_RemoveCachedFile',
        operation: ToolOperation.Write,
        description: 'Untrack paths without touching the working copy (git rm --cached).',
        input_schema: GitRemoveCachedFileInputSchema,
        input_examples: [{ paths: ['secrets.env'] }],
        buildArgs: (input) => ['rm', '--cached', '-r', '--', ...input.paths],
      },
      deps,
    ),
    createGitTool(
      {
        name: 'Git_RemoveFile',
        operation: ToolOperation.Write,
        description: 'Remove paths from the working tree and index (git rm, no force — refused unless the path is clean).',
        input_schema: GitRemoveFileInputSchema,
        input_examples: [{ paths: ['old-file.ts'] }],
        buildArgs: (input) => ['rm', '-r', '--', ...input.paths],
      },
      deps,
    ),
    createGitTool({ name: 'Git_Commit', operation: ToolOperation.Write, description: 'Record staged changes as a new commit.', input_schema: GitCommitInputSchema, input_examples: [{ message: 'Fix the flaky retry test' }], buildArgs: (input) => ['commit', '-m', input.message] }, deps),
    createGitTool(
      {
        name: 'Git_CreateBranch',
        operation: ToolOperation.Write,
        description: 'Create a new branch.',
        input_schema: GitCreateBranchInputSchema,
        input_examples: [{ name: 'feature/my-change' }],
        buildArgs: (input) => (input.from != null ? ['branch', '--end-of-options', input.name, input.from] : ['branch', '--end-of-options', input.name]),
      },
      deps,
    ),
    createGitTool(
      {
        name: 'Git_SwitchBranch',
        operation: ToolOperation.Write,
        description: 'Switch to an existing branch. Refused by git if it would discard conflicting uncommitted changes.',
        input_schema: GitSwitchBranchInputSchema,
        input_examples: [{ name: 'main' }],
        buildArgs: (input) => ['switch', '--end-of-options', input.name],
      },
      deps,
    ),
    createGitTool(
      { name: 'Git_StashSave', operation: ToolOperation.Write, description: 'Save working-tree and staged changes to a new stash entry.', input_schema: GitStashSaveInputSchema, input_examples: [{}], buildArgs: (input) => (input.message != null ? ['stash', 'push', '-m', input.message] : ['stash', 'push']) },
      deps,
    ),
    createGitTool(
      {
        name: 'Git_Fetch',
        operation: ToolOperation.Write,
        description: 'Fetch refs from a remote into the local remote-tracking branches. Does not touch the working tree.',
        input_schema: GitFetchInputSchema,
        input_examples: [{}],
        buildArgs: (input) => (input.remote != null ? ['fetch', '--end-of-options', input.remote] : ['fetch']),
      },
      deps,
    ),
    createGitTool(
      {
        name: 'Git_Pull',
        operation: ToolOperation.Write,
        description: 'Fetch and fast-forward merge from a remote. Refused by git if the merge would not be a fast-forward.',
        input_schema: GitPullInputSchema,
        input_examples: [{}],
        buildArgs: (input) => {
          const args = ['pull', '--ff-only'];
          if (input.remote != null || input.branch != null) {
            args.push('--end-of-options');
          }
          if (input.remote != null) {
            args.push(input.remote);
          }
          if (input.branch != null) {
            args.push(input.branch);
          }
          return args;
        },
      },
      deps,
    ),
    createGitTool(
      {
        name: 'Git_Push',
        operation: ToolOperation.Write,
        description: 'Push the current branch to a remote. Rejected by git if it is not a fast-forward.',
        input_schema: GitPushInputSchema,
        input_examples: [{}],
        buildArgs: (input) => {
          const args = ['push'];
          if (input.remote != null || input.branch != null) {
            args.push('--end-of-options');
          }
          if (input.remote != null) {
            args.push(input.remote);
          }
          if (input.branch != null) {
            args.push(input.branch);
          }
          return args;
        },
      },
      deps,
    ),

    // reflog — crosses no privilege boundary (unlike escalate) and destroys nothing irrecoverable
    // (unlike delete); recoverable only via the underlying system's own undo (git's reflog), not this
    // tool. Configurable via the zone matrix like read/write/delete, defaulting to Ask either way.
    createGitTool(
      {
        name: 'Git_AmendCommit',
        operation: ToolOperation.Reflog,
        description: 'Replace the tip commit. Rewrites local history — reflog-recoverable, not safe to auto-approve.',
        input_schema: GitAmendCommitInputSchema,
        input_examples: [{ intent: 'fix a typo in the commit message before pushing' }],
        buildArgs: (input) => (input.message != null ? ['commit', '--amend', '-m', input.message] : ['commit', '--amend', '--no-edit']),
        guard: defaultBranchGuard(null, 'Git_AmendCommit'),
      },
      deps,
    ),
    createGitTool(
      {
        name: 'Git_Rebase',
        operation: ToolOperation.Reflog,
        description: 'Rebase the current branch onto another ref. Rewrites local history.',
        input_schema: GitRebaseInputSchema,
        input_examples: [{ intent: 'bring the branch up to date before opening a PR', base: 'origin/main' }],
        buildArgs: (input) => ['rebase', '--end-of-options', input.base],
        guard: defaultBranchGuard(null, 'Git_Rebase'),
      },
      deps,
    ),
    createGitTool(
      {
        name: 'Git_RebaseOnto',
        operation: ToolOperation.Reflog,
        description: "Rebase only the branch's own commits (oldBase..branch) onto newBase — use when the branch was not cut from oldBase directly.",
        input_schema: GitRebaseOntoInputSchema,
        input_examples: [{ intent: 'move the branch off develop onto main now that develop merged', oldBase: 'develop', newBase: 'origin/main', branch: 'feature/my-change' }],
        buildArgs: (input) => ['rebase', '--onto', input.newBase, '--end-of-options', input.oldBase, input.branch],
        guard: protectDefaultBranch ? (input, guardDeps, cwd) => assertNotDefaultBranch(guardDeps, cwd, input.branch, 'Git_RebaseOnto') : undefined,
      },
      deps,
    ),
    createGitTool(
      {
        name: 'Git_StashDrop',
        operation: ToolOperation.Reflog,
        description: 'Permanently delete a stash entry.',
        input_schema: GitStashDropInputSchema,
        input_examples: [{ intent: 'clean up a stash that was already applied' }],
        buildArgs: (input) => (input.stashRef != null ? ['stash', 'drop', '--end-of-options', input.stashRef] : ['stash', 'drop']),
      },
      deps,
    ),
    createGitTool(
      {
        name: 'Git_DeleteBranchForce',
        operation: ToolOperation.Reflog,
        description: 'Force-delete a branch, including unmerged commits.',
        input_schema: GitDeleteBranchForceInputSchema,
        input_examples: [{ intent: 'remove a merged feature branch that is no longer needed', name: 'old-branch' }],
        buildArgs: (input) => ['branch', '-D', '--end-of-options', input.name],
        guard: protectDefaultBranch ? (input, guardDeps, cwd) => assertNotDefaultBranch(guardDeps, cwd, input.name, 'Git_DeleteBranchForce') : undefined,
      },
      deps,
    ),
    createGitTool(
      {
        name: 'Git_ForcePushWithLease',
        operation: ToolOperation.Reflog,
        description: 'Force-push, refused by git if the remote tip has moved since it was last fetched — the safer alternative to plain force, which this tool does not provide.',
        input_schema: GitForcePushWithLeaseInputSchema,
        input_examples: [{ intent: 'publish the rebase just performed on this feature branch' }],
        buildArgs: (input) => {
          const args = ['push', '--force-with-lease'];
          if (input.remote != null || input.branch != null) {
            args.push('--end-of-options');
          }
          if (input.remote != null) {
            args.push(input.remote);
          }
          if (input.branch != null) {
            args.push(input.branch);
          }
          return args;
        },
        guard: protectDefaultBranch ? (input, guardDeps, cwd) => assertNotDefaultBranch(guardDeps, cwd, input.branch ?? null, 'Git_ForcePushWithLease') : undefined,
      },
      deps,
    ),
  ];

  if (options.enableUnrecoverable) {
    tools.push(
      createGitTool(
        {
          name: 'Git_DiscardFileChanges',
          operation: ToolOperation.Delete,
          description: 'Discard uncommitted working-tree changes to paths. No recovery — this content was never committed.',
          input_schema: GitDiscardFileChangesInputSchema,
          input_examples: [{ intent: 'throw away a failed experiment before trying a different approach', paths: ['src/index.ts'] }],
          buildArgs: (input) => ['restore', '--', ...input.paths],
        },
        deps,
      ),
      createGitTool(
        {
          name: 'Git_DiscardAllChanges',
          operation: ToolOperation.Delete,
          description: 'Discard all uncommitted working-tree and staged changes (git reset --hard). No recovery for the discarded content.',
          input_schema: GitDiscardAllChangesInputSchema,
          input_examples: [{ intent: 'reset the working tree after an approach that did not pan out' }],
          buildArgs: () => ['reset', '--hard'],
        },
        deps,
      ),
      createGitTool(
        {
          name: 'Git_ForceRemoveFile',
          operation: ToolOperation.Delete,
          description: 'Force-remove paths (git rm -f), bypassing the clean/up-to-date check. Uncommitted changes are lost with no recovery.',
          input_schema: GitForceRemoveFileInputSchema,
          input_examples: [{ intent: 'remove a generated file that keeps reappearing as modified', paths: ['src/index.ts'] }],
          buildArgs: (input) => ['rm', '-f', '-r', '--', ...input.paths],
        },
        deps,
      ),
    );
  }

  return tools;
}
