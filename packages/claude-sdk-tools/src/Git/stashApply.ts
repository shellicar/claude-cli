import { defineTool, ToolOperation } from '@shellicar/claude-sdk';
import type { GitDeps } from './runGit';
import { runGit, runGitText } from './runGit';
import { GitOutputSchema, GitStashApplyInputSchema } from './schema';

/** `git stash apply` has no `--abort` — unlike merge/rebase, once it runs there is no command that
 *  restores the exact prior state. Its own conflict detection only catches an outright textual
 *  conflict; onto an already-dirty tree it will often just silently three-way-merge the stash's
 *  changes in among the existing uncommitted ones, with nothing marking which came from where. That
 *  entangling, not a conflict, is the real danger, and there is no undo for it after the fact — so
 *  the only safety available is refusing to start unless the working tree is clean. */
export function createGitStashApplyTool(deps: GitDeps) {
  return defineTool({
    name: 'Git_StashApply',
    operation: ToolOperation.Write,
    description: 'Apply a stash entry onto the working tree, keeping the stash entry. Refused unless the working tree is clean — applying onto uncommitted changes has no undo.',
    input_schema: GitStashApplyInputSchema,
    output_schema: GitOutputSchema,
    input_examples: [{ intent: 'restore the stash saved before switching branches' }],
    handler: async (input) => {
      const cwd = input.cwd ?? process.cwd();
      const status = await runGit(deps, ['status', '--porcelain'], cwd);
      if (status.stdout.trim().length > 0) {
        throw new Error('Working tree is not clean. Git_StashApply is refused on a dirty tree: applying has no --abort, so an entangled result could not be undone.');
      }
      const args = input.stashRef != null ? ['stash', 'apply', '--end-of-options', input.stashRef] : ['stash', 'apply'];
      const text = await runGitText(deps, args, cwd);
      return { textContent: text };
    },
  });
}
