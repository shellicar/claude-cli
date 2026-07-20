import { ToolOperation } from '@shellicar/claude-sdk';
import { createGitContinueAbortTools } from './continueAbort';
import { createGitTool } from './createGitTool';
import type { GitDeps } from './runGit';
import { createGitStashApplyTool } from './stashApply';
import {
  GitAddInputSchema,
  GitAmendCommitInputSchema,
  GitBlameInputSchema,
  GitBranchListInputSchema,
  GitCommitInputSchema,
  GitCreateBranchInputSchema,
  GitDeleteBranchForceInputSchema,
  GitDiffInputSchema,
  GitDiscardAllChangesInputSchema,
  GitDiscardFileChangesInputSchema,
  GitFetchInputSchema,
  GitForcePushWithLeaseInputSchema,
  GitForceRemoveFileInputSchema,
  GitLogInputSchema,
  GitPullInputSchema,
  GitPushInputSchema,
  GitRebaseInputSchema,
  GitRebaseOntoInputSchema,
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

/** Every action the SC decided is worth building, gated by the tier it was designed into.
 *  `enableUnrecoverable` mirrors Az's presence-based gating: the unrecoverable-tier tools are not
 *  registered at all unless explicitly turned on, same as an account with no configured identity
 *  simply doesn't produce a tool. `continue`/`abort` come from `createGitContinueAbortTools` instead
 *  of `createGitTool`: which git subcommand they run depends on runtime state, not the input schema. */
export function createGitTools(deps: GitDeps, options: { enableUnrecoverable: boolean }) {
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
        input_examples: [{}],
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
        input_examples: [{}],
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
    createGitTool({ name: 'Git_Show', operation: ToolOperation.Read, description: 'Show a commit, tag, or other git object.', input_schema: GitShowInputSchema, input_examples: [{ ref: 'HEAD' }], buildArgs: (input) => ['show', '--end-of-options', input.ref] }, deps),
    createGitTool(
      {
        name: 'Git_Blame',
        operation: ToolOperation.Read,
        description: 'Show what revision and author last modified each line of a file.',
        input_schema: GitBlameInputSchema,
        input_examples: [{ path: 'src/index.ts' }],
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
    createGitTool(
      {
        name: 'Git_BranchList',
        operation: ToolOperation.Read,
        description: 'List branches.',
        input_schema: GitBranchListInputSchema,
        input_examples: [{}],
        buildArgs: (input) => {
          const args = ['branch'];
          if (input.all) {
            args.push('--all');
          }
          return args;
        },
      },
      deps,
    ),
    createGitTool({ name: 'Git_TagList', operation: ToolOperation.Read, description: 'List tags.', input_schema: GitTagListInputSchema, input_examples: [{}], buildArgs: () => ['tag'] }, deps),
    createGitTool({ name: 'Git_RemoteList', operation: ToolOperation.Read, description: 'List configured remotes.', input_schema: GitRemoteListInputSchema, input_examples: [{}], buildArgs: () => ['remote', '-v'] }, deps),
    createGitTool({ name: 'Git_StashList', operation: ToolOperation.Read, description: 'List stash entries.', input_schema: GitStashListInputSchema, input_examples: [{}], buildArgs: () => ['stash', 'list'] }, deps),

    // safe
    createGitTool({ name: 'Git_Add', operation: ToolOperation.Write, description: 'Stage paths for the next commit.', input_schema: GitAddInputSchema, input_examples: [{ paths: ['src/index.ts'] }], buildArgs: (input) => ['add', '--', ...input.paths] }, deps),
    createGitTool(
      { name: 'Git_UnstageFile', operation: ToolOperation.Write, description: 'Unstage paths, leaving the working tree untouched.', input_schema: GitUnstageFileInputSchema, input_examples: [{ paths: ['src/index.ts'] }], buildArgs: (input) => ['restore', '--staged', '--', ...input.paths] },
      deps,
    ),
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
      { name: 'Git_SwitchBranch', operation: ToolOperation.Write, description: 'Switch to an existing branch. Refused by git if it would discard conflicting uncommitted changes.', input_schema: GitSwitchBranchInputSchema, input_examples: [{ name: 'main' }], buildArgs: (input) => ['switch', '--end-of-options', input.name] },
      deps,
    ),
    createGitTool({ name: 'Git_StashSave', operation: ToolOperation.Write, description: 'Save working-tree and staged changes to a new stash entry.', input_schema: GitStashSaveInputSchema, input_examples: [{}], buildArgs: (input) => (input.message != null ? ['stash', 'push', '-m', input.message] : ['stash', 'push']) }, deps),
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
    createGitTool({ name: 'Git_AmendCommit', operation: ToolOperation.Reflog, description: 'Replace the tip commit. Rewrites local history — reflog-recoverable, not safe to auto-approve.', input_schema: GitAmendCommitInputSchema, input_examples: [{}], buildArgs: (input) => (input.message != null ? ['commit', '--amend', '-m', input.message] : ['commit', '--amend', '--no-edit']) }, deps),
    createGitTool({ name: 'Git_Rebase', operation: ToolOperation.Reflog, description: 'Rebase the current branch onto another ref. Rewrites local history.', input_schema: GitRebaseInputSchema, input_examples: [{ base: 'origin/main' }], buildArgs: (input) => ['rebase', '--end-of-options', input.base] }, deps),
    createGitTool(
      {
        name: 'Git_RebaseOnto',
        operation: ToolOperation.Reflog,
        description: "Rebase only the branch's own commits (oldBase..branch) onto newBase — use when the branch was not cut from oldBase directly.",
        input_schema: GitRebaseOntoInputSchema,
        input_examples: [{ oldBase: 'develop', newBase: 'origin/main', branch: 'feature/my-change' }],
        buildArgs: (input) => ['rebase', '--onto', input.newBase, '--end-of-options', input.oldBase, input.branch],
      },
      deps,
    ),
    createGitTool(
      { name: 'Git_StashDrop', operation: ToolOperation.Reflog, description: 'Permanently delete a stash entry.', input_schema: GitStashDropInputSchema, input_examples: [{}], buildArgs: (input) => (input.stashRef != null ? ['stash', 'drop', '--end-of-options', input.stashRef] : ['stash', 'drop']) },
      deps,
    ),
    createGitTool({ name: 'Git_DeleteBranchForce', operation: ToolOperation.Reflog, description: 'Force-delete a branch, including unmerged commits.', input_schema: GitDeleteBranchForceInputSchema, input_examples: [{ name: 'old-branch' }], buildArgs: (input) => ['branch', '-D', '--end-of-options', input.name] }, deps),
    createGitTool(
      {
        name: 'Git_ForcePushWithLease',
        operation: ToolOperation.Reflog,
        description: 'Force-push, refused by git if the remote tip has moved since it was last fetched — the safer alternative to plain force, which this tool does not provide.',
        input_schema: GitForcePushWithLeaseInputSchema,
        input_examples: [{}],
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
      },
      deps,
    ),
  ];

  if (options.enableUnrecoverable) {
    tools.push(
      createGitTool({
        name: 'Git_DiscardFileChanges',
        operation: ToolOperation.Delete,
        description: 'Discard uncommitted working-tree changes to paths. No recovery — this content was never committed.',
        input_schema: GitDiscardFileChangesInputSchema,
        input_examples: [{ paths: ['src/index.ts'] }],
        buildArgs: (input) => ['restore', '--', ...input.paths],
      },
      deps,
      ),
      createGitTool(
        { name: 'Git_DiscardAllChanges', operation: ToolOperation.Delete, description: 'Discard all uncommitted working-tree and staged changes (git reset --hard). No recovery for the discarded content.', input_schema: GitDiscardAllChangesInputSchema, input_examples: [{}], buildArgs: () => ['reset', '--hard'] },
        deps,
      ),
      createGitTool(
        {
          name: 'Git_ForceRemoveFile',
          operation: ToolOperation.Delete,
          description: 'Force-remove paths (git rm -f), bypassing the clean/up-to-date check. Uncommitted changes are lost with no recovery.',
          input_schema: GitForceRemoveFileInputSchema,
          input_examples: [{ paths: ['src/index.ts'] }],
          buildArgs: (input) => ['rm', '-f', '-r', '--', ...input.paths],
        },
        deps,
      ),
    );
  }

  return tools;
}
