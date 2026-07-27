import { defineTool } from '@shellicar/claude-sdk';
import type { z } from 'zod';
import type { AzSessionCache } from '../Az/AzSessionCache';
import { resolveAzAccount } from '../Az/createAzTool';
import type { AzAccountsConfig } from '../Az/tools';
import { getGitRemoteUrl } from './gitRemote';
import type { AdoRemoteContext } from './parseAdoRemote';
import { orgNameFromRemote, parseAdoRemote } from './parseAdoRemote';
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
export type AdoPrToolSpec<TSchema extends z.ZodType<{ account?: string; cwd?: string }>> = {
  name: string;
  description: string;
  input_schema: TSchema;
  input_examples?: z.input<TSchema>[];
  subcommand: string[];
  buildArgs: (input: z.output<TSchema>, remote: AdoRemoteContext | null) => string[];
};

/** `getAccounts` is read fresh on every call (see `resolveAzAccount`), never a list captured once
 *  at tool-build time — the same live-config shape `Az/createAzTool.ts` uses, so a config reload
 *  that adds/removes a holder account takes effect on the very next call, with no tool rebuild.
 *
 *  `cache` is the same `AzSessionCache` instance `AzCli`/`EscalatedAzCli` share (see
 *  `runAdoEscalated`), so a PR call reuses an already-warm holder session instead of paying a fresh
 *  login every time. */
export function createAdoPrTool<TSchema extends z.ZodType<{ account?: string; cwd?: string }>>(spec: AdoPrToolSpec<TSchema>, deps: AdoEscalatedDeps, getAccounts: () => AzAccountsConfig, cache: AzSessionCache) {
  return defineTool({
    name: spec.name,
    // 'escalate', not 'write': this crosses a privilege boundary (the holder PAT) that must always
    // prompt, unconditionally — never subject to the cwd-zone write matrix or any auto-approve
    // config, which only ever govern ordinary file writes.
    operation: 'escalate',
    description: spec.description,
    input_schema: spec.input_schema,
    output_schema: AdoPrOutputSchema,
    input_examples: spec.input_examples ?? [],
    handler: async (input, signal) => {
      const cwd = input.cwd ?? process.cwd();
      const remoteUrl = await getGitRemoteUrl(cwd);
      const remote = remoteUrl != null ? parseAdoRemote(remoteUrl) : null;
      const account = resolveAzAccount(getAccounts, 'holder', input.account, orgNameFromRemote(remote));
      const result = await runAdoEscalated(deps, cache, account, spec.subcommand, spec.buildArgs(input, remote), cwd, signal);
      return { textContent: { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: result.exitCode } };
    },
  });
}
