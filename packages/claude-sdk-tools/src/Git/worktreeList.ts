import { defineTool, ToolOperation } from '@shellicar/claude-sdk';
import type { GitDeps } from './runGit';
import { runGit } from './runGit';
import { GitWorktreeListInputSchema, GitWorktreeListOutputSchema } from './schema';

/** `git worktree list`'s default table has no header and packs everything (path, abbreviated SHA,
 *  branch in brackets, [locked]/[prunable] markers) into one line the reader has to already know
 *  how to parse \u2014 the same shape of ambiguity Git_BranchList's `*`/`+` markers had. `--porcelain`
 *  gives the same facts as real, blank-line-separated key/value blocks instead. */
type WorktreeEntry = { path: string; head: string | null; branch: string | null; locked: string | null; prunable: string | null };

function parsePorcelain(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;

  for (const line of stdout.split('\n')) {
    if (line.length === 0) {
      continue;
    }
    if (line.startsWith('worktree ')) {
      if (current) {
        entries.push(current);
      }
      current = { path: line.slice('worktree '.length), head: null, branch: null, locked: null, prunable: null };
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length);
      const prefix = 'refs/heads/';
      current.branch = ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
    } else if (line === 'locked') {
      current.locked = '';
    } else if (line.startsWith('locked ')) {
      current.locked = line.slice('locked '.length);
    } else if (line === 'prunable') {
      current.prunable = '';
    } else if (line.startsWith('prunable ')) {
      current.prunable = line.slice('prunable '.length);
    }
  }
  if (current) {
    entries.push(current);
  }
  return entries;
}

export function createGitWorktreeListTool(deps: GitDeps) {
  return defineTool({
    name: 'Git_WorktreeList',
    operation: ToolOperation.Read,
    description: 'List worktrees.',
    input_schema: GitWorktreeListInputSchema,
    output_schema: GitWorktreeListOutputSchema,
    input_examples: [{}],
    handler: async (input) => {
      const cwd = input.cwd ?? process.cwd();
      const result = await runGit(deps, ['worktree', 'list', '--porcelain'], cwd);
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `git worktree list --porcelain failed with exit code ${result.exitCode}`);
      }
      return { textContent: parsePorcelain(result.stdout) };
    },
  });
}
