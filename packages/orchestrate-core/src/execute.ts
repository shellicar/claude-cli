import { plan } from './plan.js';
import { resolveReferences } from './resolveReferences.js';
import type { ApprovalGrant, FsOperation, PlannedStage, Stage, StageOutcome, StageReport, Stream, ToolStage, ToolV2Result } from './types.js';

/** Everything a caller needs to decide a gated stage's fate — including its own resolved
 *  `input` (e.g. `{ program: 'rm', args: [...] }`), not just what's piped into it. A decision
 *  based only on the upstream batch can never express "deny this specific command", since the
 *  command itself lives in `input`, not in what was piped in — most stages have no upstream at
 *  all (a producer with nothing piped in) and would otherwise be ungateable on their own
 *  content. */
export type ApprovalContext = {
  name: string;
  operation: FsOperation;
  input: unknown;
  batch: unknown[];
  /** This stage's own 1-based position in the `stages` array it was declared in, and that
   *  array's length — both counting EVERY stage (`Xargs` and ungated ones included), so a
   *  caller can say "where in the pipeline are we". Counting only the stages that end up
   *  asking would make the 3rd step of a 3-step run read as "1 of 3" whenever the earlier
   *  two were auto-allowed, which says nothing about where the run actually is. */
  stagePosition: number;
  stageCount: number;
};

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
  /** Passed unmodified to every stage's `run`. Orchestrate itself only ever reads `.aborted` to
   *  decide whether to keep advancing to further stages (see the top of the stage loop below) —
   *  it never drives a tool's own cancellation, that's each tool's own responsibility. */
  signal?: AbortSignal;
  /** Passed unmodified to every stage's `run`, opaque to this package. One value per whole
   *  `execute()` call, shared by every stage in it — including every stage nested inside a
   *  composed run — so a tool needing a per-batch-scoped resource (e.g. one tsserver shared by
   *  every TS tool call in the same batch) gets the same instance across the whole call. */
  scope?: unknown;
  /** The run's own variable namespace: `captureAs` writes into it, and a `$NAME` in any later
   *  stage's input reads from it. Opaque beyond get/set, so this package never learns where the
   *  variables actually live — the caller supplies a store scoped to this one run, so nothing a
   *  pipeline captures outlives it. Absent means no captures and no substitution. */
  vars?: VarStore;
  /** Passed unmodified to every stage's `run`, opaque to this package — the environment the run's
   *  processes should spawn under, carrying whatever `vars` holds. Separate from `vars` because a
   *  tool that spawns needs the whole environment, not just the ability to read a name. */
  env?: unknown;
};

/** Read/write access to the run's variables, nothing more. */
export type VarStore = { get: (name: string) => string | undefined; set: (name: string, value: string) => void };

export type ExecuteResult = {
  result: unknown[];
  reports: StageReport[];
  attachments: unknown[];
};

async function* asAsyncIterable<T>(values: T[]): Stream<T> {
  for (const v of values) {
    yield v;
  }
}

/** Passes a stage's output through untouched, counting it on the way. The count is published when
 *  the consumer is finished with it, whether that is the end of the output or an early stop. */
function countingStream<T>(source: Stream<T>, publish: (count: number) => void): Stream<T> {
  return (async function* () {
    let count = 0;
    try {
      for await (const value of source) {
        count++;
        yield value;
      }
    } finally {
      publish(count);
    }
  })();
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
  const vars = options.vars;
  const reports: StageReport[] = [];
  const attachments: unknown[] = [];

  let upstream: Stream<unknown> | AsyncIterable<unknown> | undefined;
  let lastSuccess: boolean | null = null;
  let lastOutcome: StageOutcome | null = null;
  let lastOp: ToolStage['op'] | undefined;
  let pendingInjection: { parameter: string; values: unknown[] } | null = null;
  let planIndex = 0;
  // Counts every stage, Xargs included — this is the position a human is shown, so it has to
  // match the stages array they wrote, not the subset that reaches a tool.
  let stagePosition = 0;
  // Stages that handed their stream onward and haven't been asked how they went yet. A tool's
  // `success` and `attachments` are only answerable once its stdout is finished with, which for
  // these is whenever whoever is reading them stops.
  const unsettled: Array<{ report: StageReport; result: ToolV2Result<unknown>; stream: Stream<unknown>; stderr: string[]; showStderr: boolean }> = [];

  /** Close every stream still open behind the current point and record how each stage went. A
   *  consumer that stopped early leaves its producer suspended, so each one is returned rather
   *  than left hanging: that is the signal a real producer needs to stop working. */
  async function settleStreamed(): Promise<void> {
    for (let index = unsettled.length - 1; index >= 0; index--) {
      await (unsettled[index] as (typeof unsettled)[number]).stream.return(undefined);
    }
    for (const pending of unsettled) {
      // A stage nothing ever read emitted nothing: its counter never ran, because a generator that
      // was never started has no body to unwind.
      pending.report.emitted = pending.report.emitted ?? 0;
      if (pending.result.attachments) {
        attachments.push(...pending.result.attachments());
      }
      const success = pending.result.success();
      pending.report.success = success;
      pending.report.signal = pending.result.signal?.() ?? null;
      pending.report.stderrShown = (pending.showStderr || !success) && pending.stderr.length > 0 ? pending.stderr : null;
    }
    unsettled.length = 0;
  }

  // Every path out of here settles: a stage that throws leaves its producers suspended otherwise,
  // and a suspended producer is a process nobody has told to stop. That is what the SIGPIPE abort
  // on `return()` exists for, and it only happens if something closes the stream.
  try {
    for (const stage of stages) {
      stagePosition++;
      if (options.signal?.aborted) {
        if (stage.kind === 'tool') {
          reports.push({ name: stage.tool.name, outcome: 'skipped', success: null, emitted: null, signal: null, stderrShown: null });
          lastOp = stage.op;
        }
        lastOutcome = 'skipped';
        await settleStreamed();
        upstream = undefined;
        continue;
      }

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
        await settleStreamed();
        pendingInjection = { parameter: stage.parameter, values: batch };
        upstream = undefined;
        continue;
      }

      const stagePlan = planned[planIndex] as PlannedStage;
      planIndex++;

      const shouldRun = lastOp == null ? true : lastOp === '&&' ? lastSuccess === true : lastOp === '||' ? lastSuccess === false : lastOp === '|' ? lastOutcome === 'ran' : true;
      if (!shouldRun) {
        reports.push({ name: stage.tool.name, outcome: 'skipped', success: null, emitted: null, signal: null, stderrShown: null });
        lastOp = stage.op;
        lastOutcome = 'skipped';
        await settleStreamed();
        upstream = undefined;
        // A batch belongs to the stage it was collected for. That stage never ran, so the batch
        // dies here rather than travelling on to splice itself over a later stage's own input.
        pendingInjection = null;
        continue;
      }

      let baseInput = stage.input;
      if (pendingInjection) {
        // Appended, not substituted, the way `find | xargs rm -v` puts the piped paths after the
        // fixed arguments: whatever the stage asked for in its own right still holds.
        const existing = (baseInput as Record<string, unknown>)[pendingInjection.parameter];
        baseInput = { ...baseInput, [pendingInjection.parameter]: Array.isArray(existing) ? [...existing, ...pendingInjection.values] : pendingInjection.values };
        pendingInjection = null;
      }
      const resolvedInput = vars ? resolveReferences(baseInput, vars) : baseInput;

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
        await settleStreamed();
        const outcome = await approve({ name: stage.tool.name, operation: stagePlan.operation as FsOperation, input: resolvedInput, batch: buffered, stagePosition, stageCount: stages.length });
        if (!outcome.approved) {
          reports.push({ name: stage.tool.name, outcome: 'denied', success: null, emitted: null, signal: null, stderrShown: null, message: outcome.message });
          lastSuccess = false;
          lastOutcome = 'denied';
          lastOp = stage.op;
          upstream = undefined;
          continue;
        }
        sourceForRun = buffered.length > 0 ? asAsyncIterable(buffered) : undefined;
      }

      const stderr: string[] = [];
      const toolResult = stage.tool.run(resolvedInput, sourceForRun, stderr, options.signal, options.scope, options.env);

      // A stage that pipes its output onward, and isn't asked to hold that output as a whole,
      // hands the stream itself to the next stage rather than a copy of everything it produced.
      // That is what lets `Find | Head` stop Find early: the consumer stops pulling, and the
      // generator's own `return` reaches the producer. A `captureAs` opts out by definition —
      // a capture is the stage's entire output as one value, so there is nothing to capture
      // until it has all been produced.
      if (stage.op === '|' && stage.captureAs == null) {
        const report: StageReport = { name: stage.tool.name, outcome: 'ran', success: null, emitted: null, signal: null, stderrShown: null };
        reports.push(report);
        const counted = countingStream(toolResult.stdout, (count) => {
          report.emitted = count;
        });
        unsettled.push({ report, result: toolResult, stream: counted, stderr, showStderr: stage.showStderr === true });
        upstream = counted;
        // Its verdict isn't known yet, and nothing consults it: only `&&`/`||` read a previous
        // stage's success, and this stage is joined by `|`.
        lastSuccess = null;
        lastOutcome = 'ran';
        lastOp = stage.op;
        continue;
      }

      const drained: unknown[] = [];
      for await (const value of toolResult.stdout) {
        drained.push(value);
      }
      // Draining this stage to the end means everything feeding it has been consumed as far as it
      // ever will be, so every producer still open behind it can settle now.
      await settleStreamed();
      upstream = asAsyncIterable(drained);

      if (toolResult.attachments) {
        attachments.push(...toolResult.attachments());
      }

      const success = toolResult.success();
      const shouldShowStderr = stage.showStderr === true || !success;
      reports.push({ name: stage.tool.name, outcome: 'ran', success, emitted: drained.length, signal: toolResult.signal?.() ?? null, stderrShown: shouldShowStderr && stderr.length > 0 ? stderr : null });

      if (stage.captureAs) {
        // Every registered tool yields strings (see `defineToolV2`), so a capture is the stage's own
        // text output, joined as it would have been rendered.
        vars?.set(stage.captureAs, drained.map((v) => String(v)).join('\n'));
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
    return { result: out, reports, attachments };
  } finally {
    await settleStreamed();
  }
}
