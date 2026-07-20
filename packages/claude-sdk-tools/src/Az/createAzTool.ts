import { defineTool, type ToolOperation } from '@shellicar/claude-sdk';
import type { z } from 'zod';
import type { AzSessionCache } from './AzSessionCache';
import type { AzDeps } from './runAz';
import { runAz } from './runAz';
import { AzOutputSchema } from './schema';

export type AzToolSpec<TSchema extends z.ZodType<{ account?: string; args: string[] }>> = {
  name: string;
  operation: ToolOperation;
  description: string;
  input_schema: TSchema;
  identity: 'reader' | 'holder';
  /** The sole configured account name, set only when exactly one account exists for this
   *  identity — the value `account` resolves to when the caller omits it. Undefined whenever
   *  more than one account is configured, where the schema's `.refine` already guarantees
   *  `input.account` is never omitted. */
  defaultAccount?: string;
};

/** `cache` is one `AzSessionCache` shared across every Az tool built by `createAzTools`. Its
 *  lifetime is the process, not a tool-execution block — see `AzSessionCache` for why. */
export function createAzTool<TSchema extends z.ZodType<{ account?: string; args: string[] }>>(spec: AzToolSpec<TSchema>, deps: AzDeps, cache: AzSessionCache) {
  return defineTool({
    name: spec.name,
    operation: spec.operation,
    description: spec.description,
    input_schema: spec.input_schema,
    output_schema: AzOutputSchema,
    input_examples: [],
    handler: async (input) => {
      const account = input.account ?? spec.defaultAccount;
      if (account == null) {
        throw new Error('account is required when more than one Azure account is configured');
      }
      const result = await runAz(deps, cache, spec.identity, account, input.args, process.cwd());
      return { textContent: { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: result.exitCode } };
    },
  });
}
