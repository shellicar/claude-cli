import type { ApprovalGrant, PlannedStage, Stage, ToolStage } from './types.js';

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
      const needsGate = tool.operation !== 'none' && !grant.tiers.has(tool.operation);
      return { name: tool.name, operation: tool.operation, mode: needsGate ? 'buffer-then-gate' : 'stream' } satisfies PlannedStage;
    });
}
