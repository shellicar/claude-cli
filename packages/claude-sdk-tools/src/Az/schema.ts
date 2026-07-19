import { z } from 'zod';

export const AzOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
});

/** Built per-registration from whichever account names are actually configured for a given
 *  identity (reader/holder), so the model can only ever request an account whose service
 *  principal actually exists — the enum is the structural guarantee, not a runtime check.
 *
 *  `account` is always optional in the schema's output type — with exactly one configured account
 *  there is nothing to disambiguate, so the caller may omit it. With more than one, omitting it is
 *  rejected by the `.refine` below: a default can only ever be unambiguous, never a guess among
 *  several real choices. */
export function createAzInputSchema(accounts: [string, ...string[]]) {
  const single = accounts.length === 1;
  return z
    .object({
      account: z
        .enum(accounts)
        .optional()
        .describe(single ? `Which configured Azure account to run this command against. Optional — omit to use the only configured account ('${accounts[0]}').` : 'Which configured Azure account to run this command against. Required — more than one account is configured.'),
      args: z.array(z.string()).min(1).describe('Arguments to `az`, e.g. ["group", "list"] for `az group list`. No shell — no quoting, no globbing, no operators'),
    })
    .strict()
    .refine((input) => single || input.account != null, {
      message: 'account is required when more than one Azure account is configured',
      path: ['account'],
    });
}
