import type { Operation, Stage, StageOutcome, StageReport, Stream, ToolStage, ToolV2Result } from './types.js';

/** Everything a caller needs to decide a gated stage's fate — including its own resolved
 *  `input` (e.g. `{ program: 'rm', args: [...] }`), not just what's piped into it. A decision
 *  based only on the upstream batch can never express "deny this specific command", since the
 *  command itself lives in `input`, not in what was piped in — most stages have no upstream at
 *  all (a producer with nothing piped in) and would otherwise be ungateable on their own
 *  content. */
export type ApprovalContext = {
  name: string;
  /** Everything this call does: an execution that also redirects its output to a file both executes
   *  and writes. Each is decided on separately and the strictest verdict governs. */
  operations: Operation[];
  /** What this stage will actually do: every variable resolved, every path settled. This is what a
   *  decision must be made against, or a rule about `rm -rf` never sees a `-rf` that arrived in a
   *  variable. */
  input: unknown;
  /** The same stage as the caller wrote it, variables unresolved. This is the form to show and to
   *  publish: an approval request goes out whether or not it is granted, so a value resolved into
   *  it is exposed by the asking, not by the answer. */
  asWritten: unknown;
  /** What has been piped into this stage, drained on demand. Nothing is held until something asks:
   *  a decision made on the stage's own input never drains, and a decision that has to be shown to
   *  a person does. Calling it more than once returns the same values. */
  batch: () => Promise<unknown[]>;
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

/** Thrown by `ApprovalContext.batch` when what is piped in outgrows what can be held to be shown.
 *  A decision needs all of it or none: a caller that catches this has decided on a fragment. */
export class BatchTooLarge extends Error {
  public constructor(limitBytes: number) {
    super(`more than ${limitBytes} bytes are piped into this stage, which is more than can be held to be shown`);
  }
}
export type ApprovalDecision = (ctx: ApprovalContext) => Promise<ApprovalOutcome>;

/** How far a stage may run ahead of whoever is reading it, and what happens when it reaches that.
 *  A streaming stage waits, the way a process waits on a full pipe. A gated stage cannot wait,
 *  since nothing reads it until its approval is asked and the approval needs the whole batch, so
 *  it is stopped instead of being presented half-seen. */
export type BufferPolicy = {
  streamBytes: number;
  gateBytes: number;
  /** What the run will hold to hand back. The drain that collects the result is the one reader that
   *  never gives up, so without this nothing ever tells a producer that doesn't end to stop.
   *  Larger than the gate, because this is output being returned rather than a batch someone has to
   *  read. */
  resultBytes: number;
};

export const DEFAULT_BUFFER: BufferPolicy = { streamBytes: 8 * 1024, gateBytes: 10 * 1024, resultBytes: 10 * 1024 * 1024 };

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

async function* asAsyncIterable<T>(values: T[]): Stream<T> {
  for (const v of values) {
    yield v;
  }
}

const byteLength = (value: unknown): number => Buffer.byteLength(String(value), 'utf8');

/** A stage's output, and whether it outgrew what the stage after it could hold. */
type Bounded = { stream: Stream<unknown>; overflowed: () => boolean };

/**
 * Holds a stage's output so it can run ahead of whoever is reading it, and no further than the
 * given number of bytes. A pipe is exactly this: the producer fills the buffer, and once it is
 * full the producer waits until the reader takes something out.
 *
 * `stopWhenFull` is for a stage nothing will read until it is complete, which is what an approval
 * gate is. Waiting there would never end, since the reader is waiting for the producer to finish,
 * so the producer is stopped instead and the caller is told, rather than being shown half of what
 * a stage would have done.
 */
function bounded(source: Stream<unknown> | AsyncIterable<unknown>, limitBytes: number, stopWhenFull: boolean): Bounded {
  const iterator = (source as AsyncIterable<unknown>)[Symbol.asyncIterator]();
  const queue: unknown[] = [];
  let queuedBytes = 0;
  let finished = false;
  let failure: unknown;
  let overflowed = false;
  let wakeReader: (() => void) | null = null;
  let wakeWriter: (() => void) | null = null;

  const wake = (waiter: (() => void) | null): null => {
    waiter?.();
    return null;
  };

  async function fill(): Promise<void> {
    try {
      while (true) {
        if (queuedBytes >= limitBytes) {
          if (stopWhenFull) {
            overflowed = true;
            break;
          }
          await new Promise<void>((resolve) => {
            wakeWriter = resolve;
          });
          continue;
        }
        const next = await iterator.next();
        if (next.done === true) {
          break;
        }
        queue.push(next.value);
        queuedBytes += byteLength(next.value);
        wakeReader = wake(wakeReader);
      }
    } catch (err) {
      failure = err;
    }
    finished = true;
    wakeReader = wake(wakeReader);
    if (overflowed) {
      await iterator.return?.(undefined);
    }
  }

  void fill();

  async function* read(): Stream<unknown> {
    try {
      while (true) {
        if (queue.length === 0) {
          if (finished) {
            break;
          }
          await new Promise<void>((resolve) => {
            wakeReader = resolve;
          });
          continue;
        }
        const value = queue.shift();
        queuedBytes -= byteLength(value);
        wakeWriter = wake(wakeWriter);
        yield value;
      }
      if (failure != null) {
        throw failure;
      }
    } finally {
      await iterator.return?.(undefined);
    }
  }

  const reader = read();
  // Closing has to reach the source even while the reader is parked waiting for a value that may
  // never come: a generator's own `return()` waits on that same pending promise first, so the
  // waits are released here before delegating (the trap `Program`'s own stream documents).
  const stream: Stream<unknown> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    [Symbol.asyncDispose]: async () => {
      await stream.return(undefined);
    },
    next: () => reader.next(),
    return: (value?: unknown) => {
      finished = true;
      wakeReader = wake(wakeReader);
      wakeWriter = wake(wakeWriter);
      return reader.return(value as never);
    },
    throw: (err) => reader.throw(err),
  };

  return { stream, overflowed: () => overflowed };
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

/** Runs a whole orchestration: puts every stage to `approve`, respects `&&`/`||`/`;`/`|`
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
  const buffer = options.buffer ?? DEFAULT_BUFFER;
  const approve = options.approve ?? (async () => ({ approved: true }) as const);
  const vars = options.vars;
  const reports: StageReport[] = [];
  const attachments: unknown[] = [];

  let upstream: Stream<unknown> | AsyncIterable<unknown> | undefined;
  let lastSuccess: boolean | null = null;
  let lastOutcome: StageOutcome | null = null;
  let lastOp: ToolStage['op'] | undefined;
  let pendingInjection: { parameter: string; values: unknown[]; outgrew: boolean } | null = null;
  // Counts every stage, Xargs included — this is the position a human is shown, so it has to
  // match the stages array they wrote, not the subset that reaches a tool.
  let stagePosition = 0;
  // Stages that handed their stream onward and haven't been asked how they went yet. A tool's
  // `success` and `attachments` are only answerable once its stdout is finished with, which for
  // these is whenever whoever is reading them stops.
  const unsettled: Array<{ report: StageReport; result: ToolV2Result<unknown>; stream: Stream<unknown>; stderr: string[]; showStderr: boolean }> = [];
  // Stages stopped for outgrowing what the stage after them could hold, rather than for anything
  // the tool itself did.
  const stoppedByBound = new Map<StageReport, string>();

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
        // The batch is held whole to become an argument list, so it is bounded like any other
        // thing held whole. A list cut short is not a smaller version of the same call: it is a
        // different call, so the stage it was collected for does not run.
        const batch: unknown[] = [];
        let batchBytes = 0;
        let outgrewBatch = false;
        if (source != null) {
          for await (const value of source) {
            batch.push(value);
            batchBytes += byteLength(value);
            if (batchBytes >= buffer.gateBytes) {
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
        if (pendingInjection.outgrew) {
          reports.push({ name: stage.tool.name, outcome: 'skipped', success: null, emitted: null, signal: null, stderrShown: null, message: `skipped: the argument list collected for it outgrew the ${buffer.gateBytes} bytes that can be held` });
          pendingInjection = null;
          lastSuccess = false;
          lastOutcome = 'skipped';
          lastOp = stage.op;
          upstream = undefined;
          continue;
        }
        // Appended, not substituted, the way `find | xargs rm -v` puts the piped paths after the
        // fixed arguments: whatever the stage asked for in its own right still holds.
        const existing = (baseInput as Record<string, unknown>)[pendingInjection.parameter];
        baseInput = { ...baseInput, [pendingInjection.parameter]: Array.isArray(existing) ? [...existing, ...pendingInjection.values] : pendingInjection.values };
        pendingInjection = null;
      }
      // Settled before anything judges it: variables resolved, paths made absolute. A decision has
      // to be about what will happen, not about the text that describes it. What the caller wrote
      // is kept alongside, because that is the form an approval request carries.
      const asWritten = baseInput;
      const resolvedInput = stage.prepare ? (stage.prepare(baseInput, options.env) as Record<string, unknown>) : baseInput;

      // Only a real `|` join forwards the previous stage's stdout as this stage's stdin —
      // every other join starts this stage with no upstream at all (see types.ts on `Op`).
      let sourceForRun: Stream<unknown> | AsyncIterable<unknown> | undefined = lastOp === '|' ? upstream : undefined;
      // Every stage is judged. Nothing exempts itself: a tool does not get to say it needs no
      // decision, because whether it does is the decision.
      //
      // The batch is drained only if whoever decides actually asks for it. A verdict reached on the
      // stage's own input never touches the stream, so a stage that streams keeps streaming; a
      // decision that has to be shown to a person materialises it, and the stage then runs against
      // what was shown.
      let buffered: unknown[] | undefined;
      let outgrewGate = false;
      const batch = async (): Promise<unknown[]> => {
        if (buffered != null) {
          return buffered;
        }
        const held: unknown[] = [];
        let heldBytes = 0;
        if (sourceForRun != null) {
          for await (const value of sourceForRun) {
            held.push(value);
            heldBytes += byteLength(value);
            if (heldBytes >= buffer.gateBytes) {
              // Refused rather than truncated: half of what a stage would act on is not something
              // anyone can decide about, and handing it over would look like the whole of it.
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

      // Drained to be shown, so the stage runs against what was shown rather than against a stream
      // someone already emptied.
      if (buffered != null) {
        await settleStreamed();
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
        // How far this stage may run ahead of whoever reads it, and no further.
        const held = bounded(counted, buffer.streamBytes, false);
        unsettled.push({ report, result: toolResult, stream: held.stream, stderr, showStderr: stage.showStderr === true });
        upstream = held.stream;
        // Its verdict isn't known yet, and nothing consults it: only `&&`/`||` read a previous
        // stage's success, and this stage is joined by `|`.
        lastSuccess = null;
        lastOutcome = 'ran';
        lastOp = stage.op;
        continue;
      }

      // A stage held whole rather than piped onward: bounded like everything else held whole, since
      // nothing downstream is limiting it and a producer with no end would otherwise never be told
      // to stop.
      const drained: unknown[] = [];
      let drainedBytes = 0;
      let outgrewHold: string | undefined;
      for await (const value of toolResult.stdout) {
        drained.push(value);
        drainedBytes += byteLength(value);
        if (drainedBytes >= buffer.resultBytes) {
          outgrewHold = `stopped: produced more than the ${buffer.resultBytes} bytes that can be held, so this is the start of its output`;
          break;
        }
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
      reports.push({ name: stage.tool.name, outcome: 'ran', success, emitted: drained.length, signal: toolResult.signal?.() ?? null, stderrShown: shouldShowStderr && stderr.length > 0 ? stderr : null, ...(outgrewHold != null ? { message: outgrewHold } : {}) });

      if (stage.captureAs) {
        // Every registered tool yields strings (see `defineToolV2`), so a capture is the stage's own
        // text output, joined as it would have been rendered.
        vars?.set(stage.captureAs, drained.map((v) => String(v)).join('\n'));
      }

      lastSuccess = success;
      lastOutcome = 'ran';
      lastOp = stage.op;
    }

    // The one reader that never stops of its own accord. Without a bound here nothing ever tells a
    // producer that doesn't end to stop, which is what let `Program { yes }` as a last stage run
    // until the process died.
    const out: unknown[] = [];
    let outBytes = 0;
    let outgrewResult = false;
    if (upstream != null) {
      for await (const value of upstream) {
        out.push(value);
        outBytes += byteLength(value);
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
