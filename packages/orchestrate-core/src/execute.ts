import { plan } from './plan.js';
import { resolveReferences } from './resolveReferences.js';
import type { ApprovalGrant, FsOperation, PlannedStage, Stage, StageOutcome, StageReport, Stream, ToolStage } from './types.js';

/** Everything a caller needs to decide a gated stage's fate — including its own resolved
 *  `input` (e.g. `{ program: 'rm', args: [...] }`), not just what's piped into it. A decision
 *  based only on the upstream batch can never express "deny this specific command", since the
 *  command itself lives in `input`, not in what was piped in — most stages have no upstream at
 *  all (a producer with nothing piped in) and would otherwise be ungateable on their own
 *  content. */
export type ApprovalContext = { name: string; operation: FsOperation; input: unknown; batch: unknown[] };

/** A denial can carry a message (why it was refused, e.g. Policy's own configured reason) — an
 *  approval never needs one, there's nothing to explain about being allowed to proceed. */
export type ApprovalOutcome = { approved: true } | { approved: false; message?: string };
export type ApprovalDecision = (ctx: ApprovalContext) => Promise<ApprovalOutcome>;

export type ExecuteOptions = {
  grant: ApprovalGrant;
  /** Called only for a gated stage, with its own resolved input and the fully resolved batch
   *  it's about to act on — never for a stage that's already trusted. Defaults to auto-approve,
   *  for callers (tests, a caller that pre-filters) that don't need an interactive gate. */
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
 *  the next tool's input — all centrally, so no tool needs to know about any of it.
 *
 *  A denial is a refusal, not a failure `&&`/`||` route around — it still counts as failure for
 *  their purposes (so `||` can offer a fallback, `&&` correctly won't proceed), and `;` still
 *  runs regardless (it never depended on the denied stage's data in the first place) — but a
 *  stage `|`-joined to a denied (or itself skipped) stage is skipped in turn, never run against
 *  fabricated empty data. Running it anyway would either misapply a tool that treats empty
 *  input as "everything" rather than "nothing", or report a misleading clean success for an
 *  operation that never actually happened. */
export async function execute(stages: Stage[], options: ExecuteOptions): Promise<ExecuteResult> {
  const planned = plan(stages, options.grant);
  const approve = options.approve ?? (async () => ({ approved: true }) as const);
  const captures = new Map<string, string>();
  const reports: StageReport[] = [];

  let upstream: Stream<unknown> | AsyncIterable<unknown> | undefined;
  let lastSuccess: boolean | null = null;
  let lastOutcome: StageOutcome | null = null;
  let lastOp: ToolStage['op'] | undefined;
  let pendingInjection: { parameter: string; values: unknown[] } | null = null;
  let planIndex = 0;

  for (const stage of stages) {
    if (stage.kind === 'xargs') {
      // Same rule as a tool stage: only a real `|` join from a stage that actually ran hands
      // this stage anything to drain. Xargs always needs an explicit pipe before it, same as
      // real `find | xargs ...`.
      const source = lastOp === '|' && lastOutcome === 'ran' ? upstream : undefined;
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

    const shouldRun = lastOp == null ? true : lastOp === '&&' ? lastSuccess === true : lastOp === '||' ? lastSuccess === false : lastOp === '|' ? lastOutcome === 'ran' : true;
    if (!shouldRun) {
      reports.push({ name: stage.tool.name, outcome: 'skipped', success: null, stderrShown: null });
      lastOp = stage.op;
      lastOutcome = 'skipped';
      upstream = undefined;
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
      const outcome = await approve({ name: stage.tool.name, operation: stagePlan.operation as FsOperation, input: resolvedInput, batch: buffered });
      if (!outcome.approved) {
        reports.push({ name: stage.tool.name, outcome: 'denied', success: null, stderrShown: null, message: outcome.message });
        lastSuccess = false;
        lastOutcome = 'denied';
        lastOp = stage.op;
        upstream = undefined;
        continue;
      }
      sourceForRun = buffered.length > 0 ? asAsyncIterable(buffered) : undefined;
    }

    const stderr: string[] = [];
    const toolResult = stage.tool.run(resolvedInput, sourceForRun, stderr);
    const drained: unknown[] = [];
    for await (const value of toolResult.stdout) {
      drained.push(value);
    }
    upstream = asAsyncIterable(drained);

    const success = toolResult.success();
    const shouldShowStderr = stage.showStderr === true || !success;
    reports.push({ name: stage.tool.name, outcome: 'ran', success, stderrShown: shouldShowStderr && stderr.length > 0 ? stderr : null });

    if (stage.captureAs) {
      captures.set(stage.captureAs, drained.join('\n'));
    }

    lastSuccess = success;
    lastOutcome = 'ran';
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
