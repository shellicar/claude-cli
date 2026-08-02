import type { Operation, ToolV2Result } from '@shellicar/orchestrate-core';
import { fromLines } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import type { AzSessionCache } from '../../Az/AzSessionCache.js';
import { resolveAzAccount } from '../../Az/createAzTool.js';
import type { AzDeps } from '../../Az/runAz.js';
import { runAz } from '../../Az/runAz.js';
import { AZ_CLI_TOOL_NAME, type AzAccountsConfig, ESCALATED_AZ_CLI_TOOL_NAME } from '../../Az/tools.js';
import { defineToolV2 } from '../defineToolV2.js';

export const AzToolV2Model = z.object({
  account: z.string().optional().describe('Which configured Azure account to run this command against. Optional when exactly one account is configured for this identity; required when more than one is configured.'),
  args: z.array(z.string()).min(1).describe('Arguments to `az`, e.g. ["group", "list"] for `az group list`. No shell — no quoting, no globbing, no operators'),
});

/** One of `AzCli`/`EscalatedAzCli` V2, differing only in identity/operation — same shape as V1's
 *  `createAzTool`, reusing the same `resolveAzAccount`/`runAz`. `AzCli` (reader) maps onto
 *  `fs.write`, the closest V2 tier to V1's generic `'write'` tag; `EscalatedAzCli` (holder) is
 *  `escalate` — always asks, never subject to Policy's ordinary fs.* tiers. */
function createAzToolV2(name: string, operation: Operation, description: string, identity: 'reader' | 'holder', deps: AzDeps, getAccounts: () => AzAccountsConfig, cache: AzSessionCache) {
  return defineToolV2({
    name,
    description,
    operation,
    model: AzToolV2Model,
    run: (input, _upstream, stderr): ToolV2Result => {
      let ok = true;

      async function* run(): AsyncGenerator<string, void, unknown> {
        const account = resolveAzAccount(getAccounts, identity, input.account);
        const result = await runAz(deps, cache, identity, account, input.args, process.cwd());
        ok = result.exitCode === 0;
        const stdout = result.stdout.trim();
        if (stdout.length > 0) {
          yield* stdout.split('\n');
        }
        const stderrText = result.stderr.trim();
        if (stderrText.length > 0) {
          stderr.push(...stderrText.split('\n'));
        }
      }

      return { stdout: fromLines(run()), success: () => ok };
    },
  });
}

/** `AzCli`/`EscalatedAzCli` V2, sharing `deps`/`cache` with V1's `createAzTools` and with the
 *  AzureDevOps.PullRequest.* V2 tools (see `AzureDevOps.ts`) — one `AzSessionCache` for every
 *  escalated `az` surface, V1 and V2 alike. */
export function createAzToolsV2(deps: AzDeps, getAccounts: () => AzAccountsConfig, cache: AzSessionCache) {
  return [
    createAzToolV2(AZ_CLI_TOOL_NAME, 'fs.write', 'Run an Azure CLI (`az`) command under the unprivileged reader identity of a configured account.', 'reader', deps, getAccounts, cache),
    createAzToolV2(ESCALATED_AZ_CLI_TOOL_NAME, 'escalate', 'Run an Azure CLI (`az`) command under the privileged holder identity of a configured account. Always asks for approval first.', 'holder', deps, getAccounts, cache),
  ] as const;
}
