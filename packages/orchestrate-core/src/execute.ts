import { plan } from './plan.js';
import { resolveReferences } from './resolveReferences.js';
import type { ApprovalGrant, LeafStage, PlannedStage, Stage, StageReport, Stream } from './types.js';

export type ApprovalDecision = (stageName: string, resolvedBatch: unknown[]) => Promise<boolean>;

export type ExecuteOptions = {
  grant: ApprovalGrant;
  /** Called only for a gated stage, with the fully resolved batch it's about to act on —
   *  never for a stage that's already trusted. Defaults to auto-approve, for callers (tests,
   *  a caller that pre-filters) that don't need an interactive gate. */
  approve?: ApprovalDecision;
};

export type ExecuteResult = {
  result: unknown[];
  reports: StageReport[];
};

async function* asAsyncIterable<T>(values: T[]): Stream<T> {
  for (const v of values) {
    yield v;
  }
}

/** Runs a whole orchestration: gates each stage per the plan, respects `&&`/`||`/`;`/`|`
 *  between stages, resolves capture references just-in-time, and bridges `Xargs` stages into
 *  the next leaf's input — all centrally, so no leaf needs to know about any of it. */
export async function execute(stages: Stage[], options: ExecuteOptions): Promise<ExecuteResult> {
  const planned = plan(stages, options.grant);
  const approve = options.approve ?? (async () => true);
  const captures = new Map<string, string>();
  const reports: StageReport[] = [];

  let upstream: Stream<unknown> | AsyncIterable<unknown> | undefined;
  let lastSuccess: boolean | null = null;
  let lastOp: LeafStage['op'] | undefined;
  let pendingInjection: { parameter: string; values: unknown[] } | null = null;
  let planIndex = 0;

  for (const stage of stages) {
    if (stage.kind === 'xargs') {
      // Same rule as a leaf stage: only a real `|` join hands this stage anything to drain.
      // Xargs always needs an explicit pipe before it, same as real `find | xargs ...`.
      const source = lastOp === '|' ? upstream : undefined;
      const batch: unknown[] = [];
      if (source != null) {
        for await (const value of source) {
          batch.push(value);
        }
      }
      pendingInjection = { parameter: stage.parameter, values: batch };
      upstream = undefined;
      continue;
    }

    const stagePlan = planned[planIndex] as PlannedStage;
    planIndex++;

    const shouldRun = lastOp == null ? true : lastOp === '&&' ? lastSuccess === true : lastOp === '||' ? lastSuccess === false : true;
    if (!shouldRun) {
      reports.push({ name: stage.leaf.name, ran: false, success: null, stderrShown: null });
      lastOp = stage.op;
      continue;
    }

    let baseInput = stage.input;
    if (pendingInjection) {
      baseInput = { ...baseInput, [pendingInjection.parameter]: pendingInjection.values };
      pendingInjection = null;
    }
    const resolvedInput = resolveReferences(baseInput, captures);

    // Only a real `|` join forwards the previous stage's stdout as this stage's stdin —
    // every other join starts this stage with no upstream at all (see types.ts on `Op`).
    let sourceForRun: Stream<unknown> | AsyncIterable<unknown> | undefined = lastOp === '|' ? upstream : undefined;

    if (stagePlan.mode === 'buffer-then-gate') {
      const buffered: unknown[] = [];
      if (sourceForRun != null) {
        for await (const value of sourceForRun) {
          buffered.push(value);
        }
      }
      const approved = await approve(stage.leaf.name, buffered);
      if (!approved) {
        reports.push({ name: stage.leaf.name, ran: false, success: null, stderrShown: null });
        lastSuccess = false;
        lastOp = stage.op;
        continue;
      }
      sourceForRun = buffered.length > 0 ? asAsyncIterable(buffered) : undefined;
    }

    const stderr: string[] = [];
    const leafResult = stage.leaf.run(resolvedInput, sourceForRun, stderr);
    const drained: unknown[] = [];
    for await (const value of leafResult.stdout) {
      drained.push(value);
    }
    upstream = asAsyncIterable(drained);

    const success = leafResult.success();
    const shouldShowStderr = stage.leaf.showStderr === true || !success;
    reports.push({ name: stage.leaf.name, ran: true, success, stderrShown: shouldShowStderr && stderr.length > 0 ? stderr : null });

    if (stage.captureAs) {
      captures.set(stage.captureAs, drained.join('\n'));
    }

    lastSuccess = success;
    lastOp = stage.op;
  }

  const out: unknown[] = [];
  if (upstream != null) {
    for await (const value of upstream) {
      out.push(value);
    }
  }
  return { result: out, reports };
}
