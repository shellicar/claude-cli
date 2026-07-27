import type { ApprovalGrant, FsOperation, PlannedStage, Stage, ToolStage } from './types.js';

/** Whether an operation is a pre-trustable `fs.*` tier at all — `'none'` streams
 *  unconditionally (handled separately in `plan`), and `'escalate'` (or any future non-`fs.*`
 *  category) is never a member of `ApprovalGrant.tiers`, so it can never be found "already
 *  granted" here; this is what forces it to always gate, by construction rather than by a
 *  runtime special-case that could be forgotten. */
function isFsOperation(operation: Exclude<PlannedStage['operation'], 'none'>): operation is FsOperation {
  return operation !== 'escalate';
}

/** Computes the whole run's buffering/gating shape up front, purely from the declared stages
 *  and what's already been granted — before anything executes. A stage whose `operation` tier
 *  isn't pre-trusted must buffer fully before it has a resolved value to present for approval;
 *  a `'none'`-operation stage (or one whose tier is already granted) can stream straight through.
 *  This is deliberately a pure function of shape + grant, not of runtime state — the plan is
 *  reviewable before a single byte moves. */
export function plan(stages: Stage[], grant: ApprovalGrant): PlannedStage[] {
  return stages
    .filter((s): s is ToolStage => s.kind === 'tool')
    .map(({ tool }) => {
      const needsGate = tool.operation !== 'none' && !(isFsOperation(tool.operation) && grant.tiers.has(tool.operation));
      return { name: tool.name, operation: tool.operation, mode: needsGate ? 'buffer-then-gate' : 'stream' } satisfies PlannedStage;
    });
}
