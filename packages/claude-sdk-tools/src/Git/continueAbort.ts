import { defineTool } from '@shellicar/claude-sdk';
import { detectInProgress } from './detectInProgress';
import type { GitDeps } from './runGit';
import { runGit } from './runGit';
import { GitAbortInputSchema, GitContinueInputSchema, GitOutputSchema } from './schema';

/** `continue`/`abort` don't fit `createGitTool`'s fixed buildArgs shape: which git subcommand they
 *  run depends on runtime state (a merge or a rebase in progress), not on the input schema. Both
 *  are `write` tier regardless of which they resume — see Git/tools.ts's comment for why: continuing
 *  or aborting doesn't re-decide anything, it carries out or unwinds a step of an operation that was
 *  already approved when it started. */
export function createGitContinueAbortTools(deps: GitDeps) {
  const Continue = defineTool({
    name: 'Git_Continue',
    operation: 'write',
    description: 'Continue an in-progress merge or rebase, after conflicts have been resolved. Detects which is in progress.',
    input_schema: GitContinueInputSchema,
    output_schema: GitOutputSchema,
    input_examples: [{}],
    handler: async (input) => {
      const cwd = input.cwd ?? process.cwd();
      const inProgress = await detectInProgress(deps.fs, cwd);
      if (inProgress == null) {
        throw new Error('No merge or rebase is in progress in this repo.');
      }
      const args = inProgress === 'merge' ? ['merge', '--continue'] : ['rebase', '--continue'];
      const result = await runGit(deps, args, cwd);
      return { textContent: { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: result.exitCode } };
    },
  });

  const Abort = defineTool({
    name: 'Git_Abort',
    operation: 'write',
    description: 'Abort an in-progress merge or rebase, restoring the state from before it started. Detects which is in progress.',
    input_schema: GitAbortInputSchema,
    output_schema: GitOutputSchema,
    input_examples: [{}],
    handler: async (input) => {
      const cwd = input.cwd ?? process.cwd();
      const inProgress = await detectInProgress(deps.fs, cwd);
      if (inProgress == null) {
        throw new Error('No merge or rebase is in progress in this repo.');
      }
      const args = inProgress === 'merge' ? ['merge', '--abort'] : ['rebase', '--abort'];
      const result = await runGit(deps, args, cwd);
      return { textContent: { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: result.exitCode } };
    },
  });

  return [Continue, Abort];
}
