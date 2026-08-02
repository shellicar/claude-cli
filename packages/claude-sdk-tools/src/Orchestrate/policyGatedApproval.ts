import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { collectPaths } from '@shellicar/claude-sdk';
import type { ApprovalContext, ApprovalDecision } from '@shellicar/orchestrate-core';
import type { z } from 'zod';
import { canonicalPath } from '../Policy/canonicalPath.js';
import type { PolicyStore } from '../Policy/PolicyStore.js';
import { resolve, strictest } from '../Policy/resolve.js';

/** Asking a person. Boolean only: a refusal from a person carries no message. */
export type HumanApprove = (ctx: ApprovalContext) => Promise<boolean>;

/** Enough of a registry to reach a tool's model. */
export type ToolSchemaLookup = { get: (name: string) => { model: z.ZodType } | undefined };

/** Decides a stage by Policy, asking a person only for what Policy leaves as `ask`.
 *
 *  Every decision is logged as `policy_resolution` with the verdict, the tool, what the call does
 *  and the paths it resolved to. */
export function createPolicyGatedApproval(policyStore: PolicyStore, registry: ToolSchemaLookup, fs: IFileSystem, logger: ILogger, humanApprove?: HumanApprove): ApprovalDecision {
  return async (ctx) => {
    const model = registry.get(ctx.name)?.model;
    // Resolved to the object the kernel will act on, so a symlink inside the project cannot present
    // a file outside it as one within.
    const paths = await Promise.all((model ? collectPaths(model, ctx.input) : []).map((path) => canonicalPath(fs, path)));
    // A call that both executes and writes is judged on each, and the strictest governs: the same
    // rule as a call naming several paths, for the same reason. Allowing it because one of the
    // things it does is permitted would let the other travel through on its back.
    const { verdict, message } = strictest(ctx.operations.map((operation) => resolve(policyStore.current, { tool: ctx.name, input: ctx.input, paths, operation, cwd: fs.cwd(), home: fs.homedir(), platform: fs.platform() })));
    // The verdict is about the resolved command; the line records the stage as written, so a value
    // that resolved into it is not persisted to a log file.
    logger.info('policy_resolution', { tool: ctx.name, operations: ctx.operations, verdict, paths, input: ctx.asWritten, message });
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
