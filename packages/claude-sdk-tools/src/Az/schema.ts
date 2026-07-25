import { z } from 'zod';

export const AzOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
});

/** `account` is a plain string, not an enum of currently-configured accounts: which accounts exist
 *  is live config (see `AzAccountsConfig`, read fresh per call in `createAzTool`'s handler), and a
 *  config reload must take effect on the very next call with no tool/schema rebuild. Baking today's
 *  account names into the wire schema as an enum would freeze them at whenever the tool was built.
 *  So the schema only shapes the input; whether a given name is actually configured, and whether
 *  omitting it is allowed (exactly one account configured for this identity), is validated live in
 *  the handler against the current account list. */
export const AzInputSchema = z
  .object({
    account: z.string().optional().describe('Which configured Azure account to run this command against. Optional when exactly one account is configured for this identity; required when more than one is configured.'),
    args: z.array(z.string()).min(1).describe('Arguments to `az`, e.g. ["group", "list"] for `az group list`. No shell — no quoting, no globbing, no operators'),
  })
  .strict();
