import { z } from 'zod';

const cwdSchema = z.string().optional().describe("Directory to run `git` in. Supports ~ and $VAR expansion. Determines which repo the command targets. Defaults to the CLI's own working directory when omitted.");

export const GitOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
});

// ---- read-only ----

export const GitStatusInputSchema = z.object({ cwd: cwdSchema }).strict();

export const GitDiffInputSchema = z
  .object({
    cwd: cwdSchema,
    staged: z.boolean().optional().describe('Show staged (index vs HEAD) changes instead of working-tree changes'),
    ref: z.string().optional().describe('Compare against this ref instead of HEAD'),
    path: z.string().optional().describe('Limit the diff to this path'),
  })
  .strict();

export const GitLogInputSchema = z
  .object({
    cwd: cwdSchema,
    ref: z.string().optional().describe('Ref to start the log from (defaults to HEAD)'),
    maxCount: z.number().int().positive().optional().describe('Limit the number of commits shown'),
    path: z.string().optional().describe('Limit the log to commits touching this path'),
  })
  .strict();

export const GitShowInputSchema = z
  .object({
    cwd: cwdSchema,
    ref: z.string().describe('The commit, tag, or object to show'),
  })
  .strict();

export const GitBlameInputSchema = z
  .object({
    cwd: cwdSchema,
    path: z.string().describe('File to blame'),
    ref: z.string().optional().describe('Blame as of this ref instead of the working tree'),
  })
  .strict();

export const GitBranchListInputSchema = z
  .object({
    cwd: cwdSchema,
    all: z.boolean().optional().describe('Include remote-tracking branches'),
  })
  .strict();

export const GitTagListInputSchema = z.object({ cwd: cwdSchema }).strict();

export const GitRemoteListInputSchema = z.object({ cwd: cwdSchema }).strict();

export const GitStashListInputSchema = z.object({ cwd: cwdSchema }).strict();

// ---- safe ----

export const GitAddInputSchema = z
  .object({
    cwd: cwdSchema,
    paths: z.array(z.string()).min(1).describe('Paths to stage, relative to the repo root'),
  })
  .strict();

export const GitUnstageFileInputSchema = z
  .object({
    cwd: cwdSchema,
    paths: z.array(z.string()).min(1).describe('Paths to unstage (git restore --staged), relative to the repo root'),
  })
  .strict();

export const GitRemoveCachedFileInputSchema = z
  .object({
    cwd: cwdSchema,
    paths: z.array(z.string()).min(1).describe('Paths to untrack (git rm --cached) without touching the working copy'),
  })
  .strict();

export const GitRemoveFileInputSchema = z
  .object({
    cwd: cwdSchema,
    paths: z.array(z.string()).min(1).describe('Paths to remove (git rm, no force) — refused by git unless the path is clean/up to date'),
  })
  .strict();

export const GitCommitInputSchema = z
  .object({
    cwd: cwdSchema,
    message: z.string().min(1).describe('Commit message'),
  })
  .strict();

export const GitCreateBranchInputSchema = z
  .object({
    cwd: cwdSchema,
    name: z.string().min(1).describe('Name of the new branch'),
    from: z.string().optional().describe('Ref to branch from (defaults to HEAD)'),
  })
  .strict();

export const GitSwitchBranchInputSchema = z
  .object({
    cwd: cwdSchema,
    name: z.string().min(1).describe('Branch to switch to'),
  })
  .strict();

export const GitAbortInputSchema = z.object({ cwd: cwdSchema }).strict();

export const GitContinueInputSchema = z.object({ cwd: cwdSchema }).strict();

export const GitStashSaveInputSchema = z
  .object({
    cwd: cwdSchema,
    message: z.string().optional().describe('Description for the stash entry'),
  })
  .strict();

export const GitFetchInputSchema = z
  .object({
    cwd: cwdSchema,
    remote: z.string().optional().describe('Remote to fetch from (defaults to origin)'),
  })
  .strict();

export const GitPullInputSchema = z
  .object({
    cwd: cwdSchema,
    remote: z.string().optional().describe('Remote to pull from (defaults to origin)'),
    branch: z.string().optional().describe("Branch to pull (defaults to the current branch's upstream)"),
  })
  .strict();

export const GitPushInputSchema = z
  .object({
    cwd: cwdSchema,
    remote: z.string().optional().describe('Remote to push to (defaults to origin)'),
    branch: z.string().optional().describe('Branch to push (defaults to the current branch)'),
  })
  .strict();

// ---- reflog (always escalate) ----

export const GitAmendCommitInputSchema = z
  .object({
    cwd: cwdSchema,
    message: z.string().optional().describe('Replace the commit message. Omit to keep the existing message.'),
  })
  .strict();

export const GitRebaseInputSchema = z
  .object({
    cwd: cwdSchema,
    base: z.string().describe('The ref to rebase the current branch onto'),
  })
  .strict();

export const GitRebaseOntoInputSchema = z
  .object({
    cwd: cwdSchema,
    oldBase: z.string().describe("The branch's actual current parent — where its own commits start"),
    newBase: z.string().describe('The ref to land those commits on'),
    branch: z.string().describe('The branch being rebased'),
  })
  .strict();

export const GitStashDropInputSchema = z
  .object({
    cwd: cwdSchema,
    stashRef: z.string().optional().describe('Stash entry to drop (e.g. stash@{0}). Defaults to the most recent.'),
  })
  .strict();

export const GitDeleteBranchForceInputSchema = z
  .object({
    cwd: cwdSchema,
    name: z.string().min(1).describe('Branch to force-delete, including unmerged commits'),
  })
  .strict();

export const GitForcePushWithLeaseInputSchema = z
  .object({
    cwd: cwdSchema,
    remote: z.string().optional().describe('Remote to push to (defaults to origin)'),
    branch: z.string().optional().describe('Branch to push (defaults to the current branch)'),
  })
  .strict();

// ---- unrecoverable (not registered unless explicitly enabled) ----

export const GitDiscardFileChangesInputSchema = z
  .object({
    cwd: cwdSchema,
    paths: z.array(z.string()).min(1).describe('Paths to discard working-tree changes for — uncommitted edits are lost with no recovery'),
  })
  .strict();

export const GitDiscardAllChangesInputSchema = z.object({ cwd: cwdSchema }).strict();

export const GitForceRemoveFileInputSchema = z
  .object({
    cwd: cwdSchema,
    paths: z.array(z.string()).min(1).describe('Paths to force-remove (git rm -f) — bypasses the clean/up-to-date check, uncommitted changes are lost'),
  })
  .strict();
