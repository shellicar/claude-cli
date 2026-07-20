import { defineTool, ToolOperation } from '@shellicar/claude-sdk';
import type { z } from 'zod';
import { getGitRemoteUrl } from './gitRemote';
import type { AdoRemoteContext } from './parseAdoRemote';
import { parseAdoRemote } from './parseAdoRemote';
import type { AdoEscalatedDeps } from './runAdoEscalated';
import { runAdoEscalated } from './runAdoEscalated';
import { AdoPrOutputSchema } from './schema';

export type { AdoEscalatedDeps };

/** One named AzureDevOps.PullRequest.* tool: a fixed `az repos pr` subcommand and a fixed mapping
 *  from typed input to its flags. `buildArgs` is the structural guarantee — whatever the agent puts
 *  in the fields, only the flags this function ever emits can reach az, nothing else. `remote` is
 *  the org/project/repository parsed from the target repo's own git remote when one exists — `az`'s
 *  own `--detect` only ever resolves organization, never project, so parsing it here is what
 *  actually closes that gap; explicit input fields still win over it. */
export type AdoPrToolSpec<TSchema extends z.ZodType> = {
  name: string;
  description: string;
  input_schema: TSchema;
  input_examples?: z.input<TSchema>[];
  subcommand: string[];
  buildArgs: (input: z.output<TSchema>, remote: AdoRemoteContext | null) => string[];
};

export function createAdoPrTool<TSchema extends z.ZodType>(spec: AdoPrToolSpec<TSchema>, deps: AdoEscalatedDeps) {
  return defineTool({
    name: spec.name,
    // 'escalate', not 'write': this crosses a privilege boundary (the holder PAT) that must always
    // prompt, unconditionally — never subject to the cwd-zone write matrix or any auto-approve
    // config, which only ever govern ordinary file writes.
    operation: ToolOperation.Escalate,
    description: spec.description,
    input_schema: spec.input_schema,
    output_schema: AdoPrOutputSchema,
    input_examples: spec.input_examples ?? [],
    handler: async (input) => {
      const cwd = (input as { cwd?: string }).cwd ?? process.cwd();
      const remoteUrl = await getGitRemoteUrl(cwd);
      const remote = remoteUrl != null ? parseAdoRemote(remoteUrl) : null;
      const result = await runAdoEscalated(deps, spec.subcommand, spec.buildArgs(input, remote), cwd);
      return { textContent: { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: result.exitCode } };
    },
  });
}
