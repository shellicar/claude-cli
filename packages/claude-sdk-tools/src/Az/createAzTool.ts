import { defineTool, type ToolOperation } from '@shellicar/claude-sdk';
import type { AzSessionCache } from './AzSessionCache';
import type { AzDeps } from './runAz';
import { runAz } from './runAz';
import { AzInputSchema, AzOutputSchema } from './schema';
import type { AzAccountsConfig } from './tools';

export type AzToolSpec = {
  name: string;
  operation: ToolOperation;
  description: string;
  identity: 'reader' | 'holder';
};

/** Resolves the account name a call actually runs as, against whichever accounts are configured
 *  for `identity` right now — read fresh from `getAccounts()` on every call, never a list baked in
 *  at tool-build time. Resolution order: `requested` (the explicit `account` field) always wins;
 *  otherwise `fallback` (e.g. the org parsed from the target repo's own git remote — see
 *  `orgNameFromRemote`) is used if it names a configured account; otherwise the sole configured
 *  account is used if there is exactly one. Naming an account that doesn't currently qualify is
 *  always rejected, even if it did when the tool was registered — `fallback` never bypasses that
 *  check, it only ever supplies a candidate, the same one `requested` would have to pass. */
export function resolveAzAccount(getAccounts: () => AzAccountsConfig, identity: 'reader' | 'holder', requested: string | undefined, fallback?: string): string {
  const configured = Object.entries(getAccounts())
    .filter(([, a]) => (identity === 'reader' ? a.reader : a.holder) != null)
    .map(([name]) => name);
  if (configured.length === 0) {
    throw new Error(`no account has a ${identity} identity configured`);
  }
  const account = requested ?? (fallback != null && configured.includes(fallback) ? fallback : undefined) ?? (configured.length === 1 ? configured[0] : undefined);
  if (account == null) {
    throw new Error('account is required when more than one Azure account is configured');
  }
  if (!configured.includes(account)) {
    throw new Error(`account '${account}' has no ${identity} identity configured`);
  }
  return account;
}

/** `cache` is one `AzSessionCache` shared across every Az tool built by `createAzTools`. Its
 *  lifetime is the process, not a tool-execution block — see `AzSessionCache` for why.
 *
 *  `getAccounts` is read fresh on every call (see `resolveAzAccount`) rather than captured once, so
 *  a config reload that adds/removes an account takes effect on the very next call. */
export function createAzTool(spec: AzToolSpec, deps: AzDeps, cache: AzSessionCache, getAccounts: () => AzAccountsConfig) {
  return defineTool({
    name: spec.name,
    operation: spec.operation,
    description: spec.description,
    input_schema: AzInputSchema,
    output_schema: AzOutputSchema,
    input_examples: [],
    handler: async (input) => {
      const account = resolveAzAccount(getAccounts, spec.identity, input.account);
      const result = await runAz(deps, cache, spec.identity, account, input.args, process.cwd());
      return { textContent: { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: result.exitCode } };
    },
  });
}
