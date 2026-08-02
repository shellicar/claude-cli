import { countLines, fromLines, lines } from './bytes.js';
import type { Operation, Stage, StageOutcome, StageReport, Stream, ToolStage, ToolV2Result } from './types.js';

/** What a stage is judged on. */
export type ApprovalContext = {
  name: string;
  /** Everything this call does. Each is judged, and the strictest verdict governs. */
  operations: Operation[];
  /** The call as it will run: variables resolved, paths settled. */
  input: unknown;
  /** The call as the caller wrote it. This is the form that is published. */
  asWritten: unknown;
  /** What is piped into this stage, drained on demand and only once. */
  batch: () => Promise<unknown[]>;
  /** This stage's 1-based position in the `stages` array, and that array's length. */
  stagePosition: number;
  stageCount: number;
};

/** A denial can carry a message (why it was refused, e.g. Policy's own configured reason) — an
 *  approval never needs one, there's nothing to explain about being allowed to proceed. */
export type ApprovalOutcome = { approved: true } | { approved: false; message?: string };

/** Thrown by `ApprovalContext.batch` when what is piped in outgrows what can be held. */
export class BatchTooLarge extends Error {
  public constructor(limitBytes: number) {
    super(`more than ${limitBytes} bytes are piped into this stage, which is more than can be held to be shown`);
  }
}
export type ApprovalDecision = (ctx: ApprovalContext) => Promise<ApprovalOutcome>;

/** In bytes, at every point a stage’s output is held. */
export type BufferPolicy = {
  /** How far a stage may run ahead of whoever is reading it. */
  streamBytes: number;
  /** What may be held whole in order to be shown to someone deciding. */
  gateBytes: number;
  /** What the run will hold to hand back. */
  resultBytes: number;
};

export const DEFAULT_BUFFER: BufferPolicy = { streamBytes: 64 * 1024, gateBytes: 1024 * 1024, resultBytes: 8 * 1024 * 1024 };

export type ExecuteOptions = {
  /** Defaults to `DEFAULT_BUFFER`. */
  buffer?: BufferPolicy;
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
  /** Where a `captureAs` writes. Write-only on purpose: nothing here ever reads a capture back,
   *  because a captured value must not be substituted into a stage's input. What a stage is
   *  judged on is also what an approval request carries over the wire, so a token substituted
   *  before that decision would be transmitted and logged; left as `$TOKEN` it is resolved by the
   *  process that runs, out of the environment this run spawns it under. Absent means no
   *  captures. */
  vars?: VarStore;
  /** Passed unmodified to every stage's `run`, opaque to this package — the environment the run's
   *  processes should spawn under, carrying whatever `vars` holds. Separate from `vars` because a
   *  tool that spawns needs the whole environment, not just the ability to read a name. */
  env?: unknown;
};

/** Somewhere to put a capture, and nothing else. */
export type VarStore = { set: (name: string, value: string) => void };

export type ExecuteResult = {
  result: unknown[];
  reports: StageReport[];
  attachments: unknown[];
};

/** What holding a line costs: its bytes, plus what a string and an array slot cost regardless. */
const heldCost = (line: string): number => Buffer.byteLength(line, 'utf8') + 64;

/** Runs a whole orchestration: puts every stage to `approve`, joins them per `&&`/`||`/`;`/`|`,
 *  and bridges an `Xargs` stage into the next tool's input.
 *
 *  A denial counts as failure for `&&`/`||`, and a stage `|`-joined to a denied or skipped stage is
 *  skipped rather than run against no data. */
export async function execute(stages: Stage[], options: ExecuteOptions): Promise<ExecuteResult> {
  const buffer = options.buffer ?? DEFAULT_BUFFER;
  const approve = options.approve ?? (async () => ({ approved: true }) as const);
  const vars = options.vars;
  const reports: StageReport[] = [];
  const attachments: unknown[] = [];

  let upstream: Stream | undefined;
  let lastSuccess: boolean | null = null;
  let lastOutcome: StageOutcome | null = null;
  let lastOp: ToolStage['op'] | undefined;
  let pendingInjection: { parameter: string; values: unknown[]; outgrew: boolean } | null = null;
  // Counts every stage, Xargs included — this is the position a human is shown, so it has to
  // match the stages array they wrote, not the subset that reaches a tool.
  let stagePosition = 0;
  // A tool's `success` and `attachments` are only answerable once its stdout is finished with.
  const unsettled: Array<{ report: StageReport; result: ToolV2Result; stream: Stream; stderr: string[]; showStderr: boolean; emitted: () => number | null }> = [];
  // Stages stopped for outgrowing a bound, not for anything the tool did.
  const stoppedByBound = new Map<StageReport, string>();

  /** Close every stream still open behind the current point and record how each stage went. */
  async function settleStreamed(): Promise<void> {
    for (let index = unsettled.length - 1; index >= 0; index--) {
      const pending = unsettled[index] as (typeof unsettled)[number];
      // A process has to be signalled and reaped before its verdict means anything.
      pending.stream.destroy();
      await pending.result.teardown?.();
    }
    for (const pending of unsettled) {
      pending.report.emitted = pending.emitted();
      if (pending.result.attachments) {
        attachments.push(...pending.result.attachments());
      }
      const stopped = stoppedByBound.get(pending.report);
      const success = stopped == null && pending.result.success();
      pending.report.success = success;
      pending.report.signal = pending.result.signal?.() ?? null;
      if (stopped != null) {
        pending.report.message = stopped;
      }
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
        // A list cut short is a different call, so the stage it was collected for does not run.
        const batch: string[] = [];
        let batchCost = 0;
        let outgrewBatch = false;
        if (source != null) {
          for await (const line of lines(source)) {
            batch.push(line);
            batchCost += heldCost(line);
            if (batchCost >= buffer.gateBytes) {
              outgrewBatch = true;
              break;
            }
          }
        }
        if (outgrewBatch) {
          const producer = unsettled[unsettled.length - 1];
          if (producer != null) {
            stoppedByBound.set(producer.report, `stopped: produced more than the ${buffer.gateBytes} bytes that can be collected into an argument list`);
          }
        }
        await settleStreamed();
        pendingInjection = { parameter: stage.parameter, values: batch, outgrew: outgrewBatch };
        upstream = undefined;
        continue;
      }

      const shouldRun = lastOp == null ? true : lastOp === '&&' ? lastSuccess === true : lastOp === '||' ? lastSuccess === false : lastOutcome === 'ran';
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
        if (pendingInjection.outgrew) {
          reports.push({ name: stage.tool.name, outcome: 'skipped', success: null, emitted: null, signal: null, stderrShown: null, message: `skipped: the argument list collected for it outgrew the ${buffer.gateBytes} bytes that can be held` });
          pendingInjection = null;
          lastSuccess = false;
          lastOutcome = 'skipped';
          lastOp = stage.op;
          upstream = undefined;
          continue;
        }
        // Appended, not substituted, as `xargs` does.
        const existing = (baseInput as Record<string, unknown>)[pendingInjection.parameter];
        baseInput = { ...baseInput, [pendingInjection.parameter]: Array.isArray(existing) ? [...existing, ...pendingInjection.values] : pendingInjection.values };
        pendingInjection = null;
      }
      const asWritten = baseInput;
      const resolvedInput = stage.prepare ? (stage.prepare(baseInput, options.env) as Record<string, unknown>) : baseInput;

      // Only a real `|` join forwards the previous stage's stdout as this stage's stdin —
      // every other join starts this stage with no upstream at all (see types.ts on `Op`).
      let sourceForRun: Stream | undefined = lastOp === '|' ? upstream : undefined;
      // The batch is drained only if whoever decides asks for it.
      let buffered: string[] | undefined;
      let outgrewGate = false;
      const batch = async (): Promise<unknown[]> => {
        if (buffered != null) {
          return buffered;
        }
        const held: string[] = [];
        let heldBytes = 0;
        if (sourceForRun != null) {
          for await (const line of lines(sourceForRun)) {
            held.push(line);
            heldBytes += heldCost(line);
            if (heldBytes >= buffer.gateBytes) {
              // Refused rather than truncated: half of a batch cannot be decided about.
              outgrewGate = true;
              throw new BatchTooLarge(buffer.gateBytes);
            }
          }
        }
        buffered = held;
        return held;
      };

      let outcome: ApprovalOutcome;
      try {
        outcome = await approve({ name: stage.tool.name, operations: stage.tool.operations(resolvedInput), input: resolvedInput, asWritten, batch, stagePosition, stageCount: stages.length });
      } catch (err) {
        if (!(err instanceof BatchTooLarge)) {
          throw err;
        }
        outcome = { approved: false };
      }

      // A producer stopped for outgrowing what could be held never reaches a person: what it would
      // have done cannot be shown in full, and half of it is not something to approve.
      if (outgrewGate) {
        const producer = unsettled[unsettled.length - 1];
        const reason = `produced more than the ${buffer.gateBytes} bytes that can be held for approval`;
        if (producer != null) {
          stoppedByBound.set(producer.report, `stopped: ${reason}`);
        }
        await settleStreamed();
        reports.push({ name: stage.tool.name, outcome: 'skipped', success: null, emitted: null, signal: null, stderrShown: null, ...(producer == null ? { message: `skipped: what feeds it ${reason}` } : {}) });
        lastSuccess = false;
        lastOutcome = 'skipped';
        lastOp = stage.op;
        upstream = undefined;
        continue;
      }

      if (!outcome.approved) {
        await settleStreamed();
        reports.push({ name: stage.tool.name, outcome: 'denied', success: null, emitted: null, signal: null, stderrShown: null, message: outcome.message });
        lastSuccess = false;
        lastOutcome = 'denied';
        lastOp = stage.op;
        upstream = undefined;
        continue;
      }

      // Drained to be shown, so the stage runs against what was shown.
      if (buffered != null) {
        await settleStreamed();
        sourceForRun = buffered.length > 0 ? fromLines(buffered as string[]) : undefined;
      }

      const stderr: string[] = [];
      const toolResult = stage.tool.run(resolvedInput, sourceForRun, stderr, options.signal, options.scope, options.env);

      // A capture holds the stage's whole output, so it cannot stream.
      if (stage.op === '|' && stage.captureAs == null) {
        const report: StageReport = { name: stage.tool.name, outcome: 'ran', success: null, emitted: null, signal: null, stderrShown: null };
        reports.push(report);
        // The stage's own stream is the buffer between it and its reader; nothing is added here.
        const emitted = countLines(toolResult.stdout);
        unsettled.push({ report, result: toolResult, stream: toolResult.stdout, stderr, showStderr: stage.showStderr === true, emitted });
        upstream = toolResult.stdout;
        // Only `&&`/`||` read a previous stage’s success, and this stage is joined by `|`.
        lastSuccess = null;
        lastOutcome = 'ran';
        lastOp = stage.op;
        continue;
      }

      const drained: string[] = [];
      let drainedBytes = 0;
      let outgrewHold: string | undefined;
      for await (const line of lines(toolResult.stdout)) {
        drained.push(line);
        drainedBytes += heldCost(line);
        if (drainedBytes >= buffer.resultBytes) {
          outgrewHold = `stopped: produced more than the ${buffer.resultBytes} bytes that can be held, so this is the start of its output`;
          break;
        }
      }
      // Everything feeding this stage has now been consumed as far as it ever will be.
      await settleStreamed();
      upstream = fromLines(drained as string[]);

      if (toolResult.attachments) {
        attachments.push(...toolResult.attachments());
      }

      const success = toolResult.success();
      const shouldShowStderr = stage.showStderr === true || !success;
      reports.push({ name: stage.tool.name, outcome: 'ran', success, emitted: drained.length, signal: toolResult.signal?.() ?? null, stderrShown: shouldShowStderr && stderr.length > 0 ? stderr : null, ...(outgrewHold != null ? { message: outgrewHold } : {}) });

      if (stage.captureAs) {
        vars?.set(stage.captureAs, drained.map((v) => String(v)).join('\n'));
      }

      lastSuccess = success;
      lastOutcome = 'ran';
      lastOp = stage.op;
    }

    // The one reader that never stops of its own accord.
    const out: string[] = [];
    let outBytes = 0;
    let outgrewResult = false;
    if (upstream != null) {
      for await (const line of lines(upstream)) {
        out.push(line);
        outBytes += heldCost(line);
        if (outBytes >= buffer.resultBytes) {
          outgrewResult = true;
          break;
        }
      }
    }
    if (outgrewResult) {
      const last = reports.filter((report) => report.outcome === 'ran').pop();
      if (last != null) {
        last.message = `stopped: produced more than the ${buffer.resultBytes} bytes that can be returned, so this is the start of its output`;
      }
    }
    return { result: out, reports, attachments };
  } finally {
    await settleStreamed();
  }
}
