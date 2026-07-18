import { createGhPrTool, type GhEscalatedDeps } from './createGhPrTool';
import { GhPrAutoMergeInputSchema, GhPrCommentInputSchema, GhPrCreateInputSchema, GhPrEditInputSchema, GhPrReadyInputSchema, GhPrReviewInputSchema } from './schema';

/** The six named, typed GitHub.PullRequest.* tools. Each hardcodes which gh subcommand and flags it
 *  ever emits — the structural guarantee a generic `GhCli { command }` proposer cannot give, because
 *  GitHub's fine-grained PAT permissions don't go below the `Pull requests: read-write` bucket. */
export function createGhPrTools(deps: GhEscalatedDeps) {
  const Create = createGhPrTool(
    {
      name: 'GitHub_PullRequest_Create',
      description: 'Open a new pull request as a draft. Always passes --draft — GitHub_PullRequest_Ready is the separate step that promotes it out of draft.',
      input_schema: GhPrCreateInputSchema,
      input_examples: [{ title: 'Fix the flaky retry test', body: 'Retries now back off exponentially.', base: 'main' }],
      subcommand: 'create',
      buildArgs: (input) => {
        const args = ['--title', input.title, '--body', input.body, '--base', input.base, '--draft'];
        if (input.head != null) {
          args.push('--head', input.head);
        }
        if (input.milestone != null) {
          args.push('--milestone', input.milestone);
        }
        for (const reviewer of input.reviewer ?? []) {
          args.push('--reviewer', reviewer);
        }
        for (const assignee of input.assignee ?? []) {
          args.push('--assignee', assignee);
        }
        for (const label of input.label ?? []) {
          args.push('--label', label);
        }
        return args;
      },
    },
    deps,
  );

  const Ready = createGhPrTool(
    {
      name: 'GitHub_PullRequest_Ready',
      description: 'Mark a draft pull request as ready for review.',
      input_schema: GhPrReadyInputSchema,
      input_examples: [{ number: 42 }],
      subcommand: 'ready',
      buildArgs: (input) => [String(input.number)],
    },
    deps,
  );

  const Edit = createGhPrTool(
    {
      name: 'GitHub_PullRequest_Edit',
      description: 'Edit an existing pull request: title, body, and labels.',
      input_schema: GhPrEditInputSchema,
      input_examples: [{ number: 42, addLabel: ['bug'] }],
      subcommand: 'edit',
      buildArgs: (input) => {
        const args: string[] = [String(input.number)];
        if (input.title != null) {
          args.push('--title', input.title);
        }
        if (input.body != null) {
          args.push('--body', input.body);
        }
        for (const label of input.addLabel ?? []) {
          args.push('--add-label', label);
        }
        for (const label of input.removeLabel ?? []) {
          args.push('--remove-label', label);
        }
        for (const assignee of input.addAssignee ?? []) {
          args.push('--add-assignee', assignee);
        }
        for (const assignee of input.removeAssignee ?? []) {
          args.push('--remove-assignee', assignee);
        }
        for (const reviewer of input.addReviewer ?? []) {
          args.push('--add-reviewer', reviewer);
        }
        for (const reviewer of input.removeReviewer ?? []) {
          args.push('--remove-reviewer', reviewer);
        }
        if (input.milestone != null) {
          args.push('--milestone', input.milestone);
        }
        if (input.removeMilestone) {
          args.push('--remove-milestone');
        }
        return args;
      },
    },
    deps,
  );

  const Comment = createGhPrTool(
    {
      name: 'GitHub_PullRequest_Comment',
      description: 'Add a comment to a pull request.',
      input_schema: GhPrCommentInputSchema,
      input_examples: [{ number: 42, body: 'Looks good, one small thing below.' }],
      subcommand: 'comment',
      buildArgs: (input) => [String(input.number), '--body', input.body],
    },
    deps,
  );

  const AutoMerge = createGhPrTool(
    {
      name: 'GitHub_PullRequest_AutoMerge',
      description: 'Enable or disable auto-merge on a pull request. Never performs an immediate merge — only --auto or --disable-auto is ever emitted, no merge-strategy flag.',
      input_schema: GhPrAutoMergeInputSchema,
      input_examples: [{ number: 42, enable: true }],
      subcommand: 'merge',
      buildArgs: (input) => [String(input.number), input.enable ? '--auto' : '--disable-auto'],
    },
    deps,
  );

  const Review = createGhPrTool(
    {
      name: 'GitHub_PullRequest_Review',
      description: "Leave a review on a pull request: a comment or a request for changes. Cannot approve — 'approve' is not a value this tool's type field can hold.",
      input_schema: GhPrReviewInputSchema,
      input_examples: [{ number: 42, type: 'comment', body: 'Interesting approach.' }],
      subcommand: 'review',
      buildArgs: (input) => [String(input.number), input.type === 'comment' ? '--comment' : '--request-changes', '--body', input.body],
    },
    deps,
  );

  return [Create, Ready, Edit, Comment, AutoMerge, Review] as const;
}
