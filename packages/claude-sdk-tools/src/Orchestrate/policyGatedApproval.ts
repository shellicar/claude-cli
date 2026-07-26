import { homedir } from 'node:os';
import { collectPaths } from '@shellicar/claude-sdk';
import type { ApprovalContext, ApprovalDecision } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { resolve } from '../Policy/resolve.js';
import type { PolicyStore } from '../Policy/PolicyStore.js';

/** The human-ask shape QueryRunner supplies (via `IOrchestrateEngine.run`'s own
 *  `requestApproval` parameter) — boolean only. A human denial needs no explanation carried
 *  back through the engine the way a Policy denial does (Policy's `message` explains an
 *  automatic decision the model didn't make; a human saying no needs none). */
export type HumanApprove = (ctx: ApprovalContext) => Promise<boolean>;

/** What `createPolicyGatedApproval` needs to extract a stage's real path fields \u2014 the same
 *  `isPath`-marked schema every V2 tool already carries for its own model. Narrower than
 *  `ToolsV2Registry` itself so this module doesn't depend on its concrete shape. */
export type ToolSchemaLookup = { get: (name: string) => { model: z.ZodType } | undefined };

/** Wraps a human-ask approval callback with a Policy pre-check. `allow`/`deny` are decided
 *  before the human is ever asked \u2014 a human-ask happens only when Policy itself says `ask`,
 *  and only if one was supplied at all (matching the existing "no human-ask configured means
 *  auto-approve" contract). This is where V2's own approval is genuinely decided; the human-ask
 *  callback QueryRunner provides is only the escape hatch for what Policy leaves undecided.
 *
 *  Extracts the stage's own marked path fields (`isPath`, the same marker V1 tools already
 *  carry) via `collectPaths` against that tool's own model \u2014 without this, every `path`-scoped
 *  policy rule (`$PWD`, `*`) can never match anything, since there would be no paths to test
 *  it against, and every V2 call would fall through to the final catch-all regardless of cwd. */
export function createPolicyGatedApproval(policyStore: PolicyStore, registry: ToolSchemaLookup, cwd: () => string, humanApprove?: HumanApprove): ApprovalDecision {
  return async (ctx) => {
    const model = registry.get(ctx.name)?.model;
    const paths = model ? collectPaths(model, ctx.input) : [];
    const { verdict, message } = resolve(policyStore.current, { tool: ctx.name, input: ctx.input, paths, operation: ctx.operation, cwd: cwd(), home: homedir() });
    if (verdict === 'allow') {
      return { approved: true };
    }
    if (verdict === 'deny') {
      return { approved: false, message };
    }
    const approved = humanApprove ? await humanApprove(ctx) : true;
    return { approved };
  };
}
