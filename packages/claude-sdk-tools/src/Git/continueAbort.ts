import { defineTool, ToolOperation } from '@shellicar/claude-sdk';
import { detectInProgress } from './detectInProgress';
import type { GitDeps } from './runGit';
import { runGitText } from './runGit';
import { GitAbortInputSchema, GitContinueInputSchema, GitOutputSchema } from './schema';

/** `continue`/`abort` don't fit `createGitTool`'s fixed buildArgs shape: which git subcommand they
 *  run depends on runtime state (a merge or a rebase in progress), not on the input schema. Both
 *  are `write` tier regardless of which they resume — see Git/tools.ts's comment for why: continuing
 *  or aborting doesn't re-decide anything, it carries out or unwinds a step of an operation that was
 *  already approved when it started. */
export function createGitContinueAbortTools(deps: GitDeps) {
  const Continue = defineTool({
    name: 'Git_Continue',
    operation: ToolOperation.Write,
    description: 'Continue an in-progress merge, rebase, cherry-pick, or revert, after conflicts have been resolved. Detects which is in progress.',
    input_schema: GitContinueInputSchema,
    output_schema: GitOutputSchema,
    input_examples: [{}],
    handler: async (input) => {
      const cwd = input.cwd ?? process.cwd();
      const inProgress = await detectInProgress(deps.fs, cwd);
      if (inProgress == null) {
        throw new Error('No merge, rebase, cherry-pick, or revert is in progress in this repo.');
      }
      const text = await runGitText(deps, [inProgress, '--continue'], cwd);
      return { textContent: text };
    },
  });

  const Abort = defineTool({
    name: 'Git_Abort',
    operation: ToolOperation.Write,
    description: 'Abort an in-progress merge, rebase, cherry-pick, or revert, restoring the state from before it started. Detects which is in progress.',
    input_schema: GitAbortInputSchema,
    output_schema: GitOutputSchema,
    input_examples: [{}],
    handler: async (input) => {
      const cwd = input.cwd ?? process.cwd();
      const inProgress = await detectInProgress(deps.fs, cwd);
      if (inProgress == null) {
        throw new Error('No merge, rebase, cherry-pick, or revert is in progress in this repo.');
      }
      const text = await runGitText(deps, [inProgress, '--abort'], cwd);
      return { textContent: text };
    },
  });

  return [Continue, Abort];
}
