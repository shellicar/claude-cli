import { z } from 'zod';

const cwdSchema = z.string().optional().describe("Directory to run `git` in. Supports ~ and $VAR expansion. Determines which repo the command targets. Defaults to the CLI's own working directory when omitted.");

/** For any field that reaches git as a bare (non-flag-value) argument — a revision, branch, remote,
 *  or stash ref. A leading '-' would let git parse it as an option instead of a value (e.g. a
 *  `base` of `--exec=...rm -rf ...` on Git_Rebase, or a `remote` of `--upload-pack=...` on
 *  Git_Fetch) — the classic git argument-injection RCE class. Rejected here as the reliable,
 *  version-independent guard; `--end-of-options` is also inserted in buildArgs as a second layer. */
function refArg(description: string) {
  return z
    .string()
    .min(1)
    .refine((value) => !value.startsWith('-'), { message: "must not start with '-' — git would parse it as an option, not a value" })
    .describe(description);
}

/** For a call whose target doesn't explain itself — the same ref/branch/path could serve a dozen
 *  different purposes, and whoever's watching can't tell which without being told. Required, not
 *  optional: the point is that it's always stated, the same way ExecV3's own `intent` field always
 *  is, so a wrong assumption gets caught before the call runs rather than inferred after the fact. */
const intentField = z.string().min(1).describe('Your intent for this call — the goal, not a restatement of the arguments.');

export const GitOutputSchema = z.string();

// ---- read-only ----

export const GitStatusInputSchema = z.object({ cwd: cwdSchema }).strict();

export const GitDiffInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    staged: z.boolean().optional().describe('Show staged (index vs HEAD) changes instead of working-tree changes'),
    ref: refArg('Compare against this ref instead of HEAD').optional(),
    path: z.string().optional().describe('Limit the diff to this path'),
  })
  .strict();

export const GitLogInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    ref: refArg('Ref to start the log from (defaults to HEAD)').optional(),
    maxCount: z.number().int().positive().optional().describe('Limit the number of commits shown'),
    path: z.string().optional().describe('Limit the log to commits touching this path'),
  })
  .strict();

export const GitShowInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    ref: refArg('The commit, tag, or object to show'),
  })
  .strict();

export const GitBlameInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    path: z.string().describe('File to blame'),
    ref: refArg('Blame as of this ref instead of the working tree').optional(),
  })
  .strict();

export const GitBranchListInputSchema = z
  .object({
    cwd: cwdSchema,
    all: z.boolean().optional().describe('Include remote-tracking branches'),
  })
  .strict();

export const GitBranchListOutputSchema = z.array(
  z.object({
    name: z.string(),
    current: z.boolean().describe('True for the branch HEAD currently points at'),
    worktreePath: z.string().nullable().describe('The linked worktree this branch is checked out in, or null when not checked out in another worktree'),
  }),
);

export const GitTagListInputSchema = z.object({ cwd: cwdSchema }).strict();

export const GitRemoteListInputSchema = z.object({ cwd: cwdSchema }).strict();

export const GitStashListInputSchema = z.object({ cwd: cwdSchema }).strict();

export const GitReflogInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    ref: refArg('Show the reflog for this ref instead of HEAD').optional(),
    maxCount: z.number().int().positive().optional().describe('Limit the number of reflog entries shown'),
  })
  .strict();

export const GitMergeBaseInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    refA: refArg('The first ref'),
    refB: refArg('The second ref'),
  })
  .strict();

export const GitDescribeInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    ref: refArg('Describe this ref instead of HEAD').optional(),
    tags: z.boolean().optional().describe('Consider lightweight tags too, not just annotated ones'),
  })
  .strict();

export const GitConfigInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    key: refArg('A specific config key to read (e.g. user.email). Omit to list the whole effective config.').optional(),
  })
  .strict();

export const GitLsFilesInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    path: z.string().optional().describe('Limit the listing to this path'),
  })
  .strict();

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
    name: refArg('Name of the new branch'),
    from: refArg('Ref to branch from (defaults to HEAD)').optional(),
  })
  .strict();

export const GitSwitchBranchInputSchema = z
  .object({
    cwd: cwdSchema,
    name: refArg('Branch to switch to'),
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

export const GitStashApplyInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    stashRef: refArg('Stash entry to apply (e.g. stash@{0}). Defaults to the most recent.').optional(),
  })
  .strict();

export const GitFetchInputSchema = z
  .object({
    cwd: cwdSchema,
    remote: refArg('Remote to fetch from (defaults to origin)').optional(),
  })
  .strict();

export const GitPullInputSchema = z
  .object({
    cwd: cwdSchema,
    remote: refArg('Remote to pull from (defaults to origin)').optional(),
    branch: refArg("Branch to pull (defaults to the current branch's upstream)").optional(),
  })
  .strict();

export const GitPushInputSchema = z
  .object({
    cwd: cwdSchema,
    remote: refArg('Remote to push to (defaults to origin)').optional(),
    branch: refArg('Branch to push (defaults to the current branch)').optional(),
  })
  .strict();

// ---- reflog (always escalate) ----

export const GitAmendCommitInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    message: z.string().optional().describe('Replace the commit message. Omit to keep the existing message.'),
  })
  .strict();

export const GitRebaseInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    base: refArg('The ref to rebase the current branch onto'),
  })
  .strict();

export const GitRebaseOntoInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    oldBase: refArg("The branch's actual current parent — where its own commits start"),
    newBase: refArg('The ref to land those commits on'),
    branch: refArg('The branch being rebased'),
  })
  .strict();

export const GitStashDropInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    stashRef: refArg('Stash entry to drop (e.g. stash@{0}). Defaults to the most recent.').optional(),
  })
  .strict();

export const GitDeleteBranchForceInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    name: refArg('Branch to force-delete, including unmerged commits'),
  })
  .strict();

export const GitForcePushWithLeaseInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    remote: refArg('Remote to push to (defaults to origin)').optional(),
    branch: refArg('Branch to push (defaults to the current branch)').optional(),
  })
  .strict();

// ---- unrecoverable (not registered unless explicitly enabled) ----

export const GitDiscardFileChangesInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    paths: z.array(z.string()).min(1).describe('Paths to discard working-tree changes for — uncommitted edits are lost with no recovery'),
  })
  .strict();

export const GitDiscardAllChangesInputSchema = z.object({ cwd: cwdSchema, intent: intentField }).strict();

export const GitForceRemoveFileInputSchema = z
  .object({
    cwd: cwdSchema,
    intent: intentField,
    paths: z.array(z.string()).min(1).describe('Paths to force-remove (git rm -f) — bypasses the clean/up-to-date check, uncommitted changes are lost'),
  })
  .strict();
