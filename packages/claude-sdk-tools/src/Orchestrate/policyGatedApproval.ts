import { homedir } from 'node:os';
import type { ApprovalDecision } from '@shellicar/orchestrate-core';
import { resolve } from '../Policy/resolve.js';
import type { PolicyStore } from '../Policy/PolicyStore.js';

/** Wraps a human-ask approval callback with a Policy pre-check. `allow`/`deny` are decided
 *  before the human is ever asked \u2014 a human-ask happens only when Policy itself says `ask`,
 *  and only if one was supplied at all (matching the existing "no human-ask configured means
 *  auto-approve" contract). This is where V2's own approval is genuinely decided; the human-ask
 *  callback QueryRunner provides is only the escape hatch for what Policy leaves undecided. */
export function createPolicyGatedApproval(policyStore: PolicyStore, cwd: () => string, humanApprove?: ApprovalDecision): ApprovalDecision {
  return async (ctx) => {
    const { verdict } = resolve(policyStore.current, { tool: ctx.name, input: ctx.input, paths: [], operation: ctx.operation, cwd: cwd(), home: homedir() });
    if (verdict === 'allow') {
      return true;
    }
    if (verdict === 'deny') {
      return false;
    }
    return humanApprove ? humanApprove(ctx) : true;
  };
}
