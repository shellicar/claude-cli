import { defineTool, type ToolOperation } from '@shellicar/claude-sdk';
import type { z } from 'zod';
import type { GitDeps } from './runGit';
import { runGit } from './runGit';
import { GitOutputSchema } from './schema';

/** One named Git.* tool: a fixed mapping from typed input to git args. `buildArgs` is the
 *  structural guarantee — whatever the agent puts in the fields, only the args this function ever
 *  emits can reach git, nothing else. `operation` is fixed at registration: it is the tier this
 *  action was designed into (read / write / escalate), not something the handler decides per call. */
export type GitToolSpec<TSchema extends z.ZodType<{ cwd?: string }>> = {
  name: string;
  operation: ToolOperation;
  description: string;
  input_schema: TSchema;
  input_examples?: z.input<TSchema>[];
  buildArgs: (input: z.output<TSchema>) => string[];
  /** Runs before buildArgs/runGit; throwing refuses the call. For a check that needs to inspect repo
   *  state beyond the input itself (e.g. resolving whether the target is the default branch), not
   *  something the input schema alone can express. */
  guard?: (input: z.output<TSchema>, deps: GitDeps, cwd: string) => Promise<void>;
};

export function createGitTool<TSchema extends z.ZodType<{ cwd?: string }>>(spec: GitToolSpec<TSchema>, deps: GitDeps) {
  return defineTool({
    name: spec.name,
    operation: spec.operation,
    description: spec.description,
    input_schema: spec.input_schema,
    output_schema: GitOutputSchema,
    input_examples: spec.input_examples ?? [],
    handler: async (input) => {
      const cwd = input.cwd ?? process.cwd();
      if (spec.guard) {
        await spec.guard(input, deps, cwd);
      }
      const result = await runGit(deps, spec.buildArgs(input), cwd);
      return { textContent: { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: result.exitCode } };
    },
  });
}
