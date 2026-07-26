import { homedir } from 'node:os';
import type { ApprovalContext, ApprovalDecision } from '@shellicar/orchestrate-core';
import { resolve } from '../Policy/resolve.js';
import type { PolicyStore } from '../Policy/PolicyStore.js';

/** The human-ask shape QueryRunner supplies (via `IOrchestrateEngine.run`'s own
 *  `requestApproval` parameter) — boolean only. A human denial needs no explanation carried
 *  back through the engine the way a Policy denial does (Policy's `message` explains an
 *  automatic decision the model didn't make; a human saying no needs none). */
export type HumanApprove = (ctx: ApprovalContext) => Promise<boolean>;

/** Wraps a human-ask approval callback with a Policy pre-check. `allow`/`deny` are decided
 *  before the human is ever asked \u2014 a human-ask happens only when Policy itself says `ask`,
 *  and only if one was supplied at all (matching the existing "no human-ask configured means
 *  auto-approve" contract). This is where V2's own approval is genuinely decided; the human-ask
 *  callback QueryRunner provides is only the escape hatch for what Policy leaves undecided. */
export function createPolicyGatedApproval(policyStore: PolicyStore, cwd: () => string, humanApprove?: HumanApprove): ApprovalDecision {
  return async (ctx) => {
    const { verdict, message } = resolve(policyStore.current, { tool: ctx.name, input: ctx.input, paths: [], operation: ctx.operation, cwd: cwd(), home: homedir() });
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
