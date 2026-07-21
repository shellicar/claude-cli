import { defineTool, ToolOperation } from '@shellicar/claude-sdk';
import type { GitDeps } from './runGit';
import { runGit } from './runGit';
import { GitBranchListInputSchema, GitBranchListOutputSchema } from './schema';

/** `git branch`'s own table uses a leading `*`/`+`/blank-space marker to say "current" vs "checked
 *  out in another worktree" vs neither — a convention unreadable without already knowing it, and
 *  the exact ambiguity this tool exists to remove. `--format` asks git for the same facts as real,
 *  named fields instead of a table a reader has to decode. */
const FORMAT = '%(HEAD)%09%(refname:short)%09%(worktreepath)';

export function createGitBranchListTool(deps: GitDeps) {
  return defineTool({
    name: 'Git_BranchList',
    operation: ToolOperation.Read,
    description: 'List branches.',
    input_schema: GitBranchListInputSchema,
    output_schema: GitBranchListOutputSchema,
    input_examples: [{}],
    handler: async (input) => {
      const cwd = input.cwd ?? process.cwd();
      const args = ['branch', `--format=${FORMAT}`];
      if (input.all) {
        args.push('--all');
      }
      const result = await runGit(deps, args, cwd);
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed with exit code ${result.exitCode}`);
      }
      const branches = result.stdout
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          const [head, name, worktreePath] = line.split('\t');
          return { name: name ?? '', current: head === '*', worktreePath: worktreePath && worktreePath.length > 0 ? worktreePath : null };
        });
      return { textContent: branches };
    },
  });
}
