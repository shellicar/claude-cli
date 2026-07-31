import { homedir } from 'node:os';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { collectPaths } from '@shellicar/claude-sdk';
import type { ApprovalContext, ApprovalDecision } from '@shellicar/orchestrate-core';
import type { z } from 'zod';
import type { PolicyStore } from '../Policy/PolicyStore.js';
import { resolve } from '../Policy/resolve.js';

/** The human-ask shape QueryRunner supplies (via `IOrchestrateEngine.run`'s own
 *  `requestApproval` parameter) — boolean only. A human denial needs no explanation carried
 *  back through the engine the way a Policy denial does (Policy's `message` explains an
 *  automatic decision the model didn't make; a human saying no needs none). */
export type HumanApprove = (ctx: ApprovalContext) => Promise<boolean>;

/** What `createPolicyGatedApproval` needs to extract a stage's real path fields — the same
 *  `isPath`-marked schema every V2 tool already carries for its own model. Narrower than
 *  `ToolsV2Registry` itself so this module doesn't depend on its concrete shape. */
export type ToolSchemaLookup = { get: (name: string) => { model: z.ZodType } | undefined };

/** Wraps a human-ask approval callback with a Policy pre-check. `allow`/`deny` are decided
 *  before the human is ever asked — a human-ask happens only when Policy itself says `ask`,
 *  and only if one was supplied at all (matching the existing "no human-ask configured means
 *  auto-approve" contract). This is where V2's own approval is genuinely decided; the human-ask
 *  callback QueryRunner provides is only the escape hatch for what Policy leaves undecided.
 *
 *  Extracts the stage's own marked path fields (`isPath`, the same marker V1 tools already
 *  carry) via `collectPaths` against that tool's own model — without this, every `path`-scoped
 *  policy rule (`$PWD`, `*`) can never match anything, since there would be no paths to test
 *  it against, and every V2 call would fall through to the final catch-all regardless of cwd.
 *
 *  Every decision is logged under the one distinct, grep-able message name `policy_resolution`
 *  — verdict, tool, operation, and the extracted paths — same discipline as V1's
 *  `Auto approving`/`Auto denying` logs, so a wrong outcome is debuggable from the log alone
 *  instead of needing to be re-derived from the policy file by hand. */
export function createPolicyGatedApproval(policyStore: PolicyStore, registry: ToolSchemaLookup, cwd: () => string, logger: ILogger, humanApprove?: HumanApprove): ApprovalDecision {
  return async (ctx) => {
    const model = registry.get(ctx.name)?.model;
    const paths = model ? collectPaths(model, ctx.input) : [];
    const { verdict, message } = resolve(policyStore.current, { tool: ctx.name, input: ctx.input, paths, operation: ctx.operation, cwd: cwd(), home: homedir() });
    // The verdict is about the resolved command; the line records the stage as written, so a value
    // that resolved into it is not persisted to a log file.
    logger.info('policy_resolution', { tool: ctx.name, operation: ctx.operation, verdict, paths, input: ctx.asWritten, message });
    if (verdict === 'allow') {
      return { approved: true };
    }
    if (verdict === 'deny') {
      return { approved: false, message };
    }
    if (!humanApprove) {
      logger.info('policy_resolution_ask_auto_approved', { tool: ctx.name, reason: 'no human-ask callback configured' });
      return { approved: true };
    }
    const approved = await humanApprove(ctx);
    logger.info('policy_resolution_ask_answered', { tool: ctx.name, approved });
    return { approved };
  };
}
