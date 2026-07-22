import { defineTool, ToolOperation } from '@shellicar/claude-sdk';
import type { z } from 'zod';
import type { GhEscalatedDeps } from './runGhEscalated';
import { runGhEscalated } from './runGhEscalated';
import { GhPrOutputSchema } from './schema';

export type { GhEscalatedDeps };

/** One named GitHub.PullRequest.* tool: a fixed subcommand and a fixed mapping from typed input to
 *  gh flags. `buildArgs` is the structural guarantee — whatever the agent puts in the fields, only
 *  the flags this function ever emits can reach gh, nothing else. */
export type GhPrToolSpec<TSchema extends z.ZodType> = {
  name: string;
  description: string;
  input_schema: TSchema;
  input_examples?: z.input<TSchema>[];
  subcommand: string;
  buildArgs: (input: z.output<TSchema>) => string[];
};

export function createGhPrTool<TSchema extends z.ZodType>(spec: GhPrToolSpec<TSchema>, deps: GhEscalatedDeps) {
  return defineTool({
    name: spec.name,
    // 'escalate', not 'write': this crosses a privilege boundary (the holder credential) that must
    // always prompt, unconditionally — never subject to the cwd-zone write matrix or any
    // auto-approve config, which only ever govern ordinary file writes.
    operation: ToolOperation.Escalate,
    description: spec.description,
    input_schema: spec.input_schema,
    output_schema: GhPrOutputSchema,
    input_examples: spec.input_examples ?? [],
    handler: async (input) => {
      const cwd = (input as { cwd?: string }).cwd ?? process.cwd();
      const result = await runGhEscalated(deps, spec.subcommand, spec.buildArgs(input), cwd);
      return { textContent: { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: result.exitCode } };
    },
  });
}
