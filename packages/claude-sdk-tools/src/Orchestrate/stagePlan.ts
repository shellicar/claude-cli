import type { Op } from '@shellicar/orchestrate-core';

/** What a wire stage says before anything is known about the tools it names. */
export type WireToolStage = { tool: string; input: unknown; op?: Op; showStderr?: boolean; captureAs?: string };
export type WireXargsStage = { xargs: true };
export type WireStage = WireToolStage | WireXargsStage;

export const isXargsStage = (stage: WireStage): stage is WireXargsStage => 'xargs' in stage;

/** Everything the sequence needs to know about one tool: the field an `Xargs` fills, whether the
 *  tool's own schema demands that field, and whether the tool reads what a `|` pipes into it.
 *  Deliberately not the tool itself, so the sequence can be reasoned about (and tested) without
 *  building a registry or a schema.
 *
 *  Requiredness is the tool's own business: `Read` cannot act without paths, while `Program`'s
 *  arguments are optional because `Program { cat }` reading a pipe is a whole command. */
export type ToolFacts = { xargsTarget?: string; xargsTargetRequired?: boolean; readsUpstream: boolean };
export type ToolFactsLookup = (name: string) => ToolFacts | undefined;

export type StageIssue = { message: string; path: (string | number)[] };

/** One stage, with what the sequence around it settled: which field the preceding `Xargs` fills,
 *  so nothing downstream has to work it out from the schema a second time. */
export type PlannedStage = { kind: 'tool'; wire: WireToolStage; fedBy?: string } | { kind: 'xargs'; parameter: string };

export type StagePlan = { ok: true; stages: PlannedStage[] } | { ok: false; issues: StageIssue[] };

/** Whether a sequence holds together, and what each stage receives. Every rule is about a stage's
 *  neighbours, which is why none can live in a stage's own schema. */
export function planStages(stages: WireStage[], lookup: ToolFactsLookup): StagePlan {
  const issues: StageIssue[] = [];
  const planned: PlannedStage[] = [];

  const last = stages[stages.length - 1];
  if (last != null && !isXargsStage(last) && last.op != null) {
    issues.push({ message: 'The last stage must not have an op set — there is nothing after it to join to.', path: ['stages'] });
  }

  stages.forEach((stage, index) => {
    const previous = index > 0 ? (stages[index - 1] as WireStage) : undefined;

    if (isXargsStage(stage)) {
      const next = stages[index + 1];
      if (next == null || isXargsStage(next)) {
        issues.push({ message: 'Xargs must be followed by the tool stage it feeds.', path: ['stages', index] });
        return;
      }
      const target = lookup(next.tool)?.xargsTarget;
      if (target == null) {
        issues.push({ message: `Xargs cannot feed ${next.tool}: it takes no argument list. Pipe into it directly if it reads a pipe, or drop the Xargs.`, path: ['stages', index] });
        return;
      }
      planned.push({ kind: 'xargs', parameter: target });
      return;
    }

    const facts = lookup(stage.tool) as ToolFacts;

    const fedByXargs = previous != null && isXargsStage(previous);
    if (facts.xargsTarget != null && facts.xargsTargetRequired === true && !fedByXargs && (stage.input as Record<string, unknown> | undefined)?.[facts.xargsTarget] == null) {
      issues.push({ message: `${stage.tool} needs ${facts.xargsTarget}, either supplied here or fed by an Xargs stage before it.`, path: ['stages', index, 'input', facts.xargsTarget] });
    }

    // `op` is written on the producing stage, so the issue is reported there.
    if (previous != null && !isXargsStage(previous) && previous.op === '|' && !facts.readsUpstream) {
      const fix = facts.xargsTarget != null ? `Put an Xargs stage between them to append the piped values to ${stage.tool}'s ${facts.xargsTarget}.` : `${stage.tool} cannot take piped input at all.`;
      issues.push({ message: `${previous.tool} pipes into ${stage.tool}, which does not read a pipe, so its output would be discarded. ${fix}`, path: ['stages', index - 1, 'op'] });
    }

    planned.push({ kind: 'tool', wire: stage, fedBy: fedByXargs ? facts.xargsTarget : undefined });
  });

  return issues.length > 0 ? { ok: false, issues } : { ok: true, stages: planned };
}
