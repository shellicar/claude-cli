import { type Channel, channel } from './channel.js';
import type { Ended, Op, Reader, Running, Stage, ToolStage } from './types.js';

/** How a stage ended: what its tool said, or what the run had to say instead. */
export type Outcome = Ended | { kind: 'refused'; reason?: string } | { kind: 'skipped' } | { kind: 'threw'; error: unknown } | { kind: 'truncated' } | { kind: 'timedOut' };

export type StageReport = { name: string; ended: Outcome };

export type RunResult = { output: Buffer; stages: StageReport[] };

export type ApprovalContext = {
  name: string;
  operations: string[];
  input: Record<string, unknown>;
  /** What this stage would act on, held whole. Nothing is held unless this is called. */
  batch: () => Promise<Buffer>;
};

export type ApprovalOutcome = { verdict: 'allow' } | { verdict: 'refuse'; reason?: string };

export type RunOptions = {
  decide: (ctx: ApprovalContext) => Promise<ApprovalOutcome>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** How much may be held whole: to be shown to whoever decides, or to be handed back. */
  hold: number;
  /** How far a stage may be ahead of whoever reads it. */
  ahead: number;
  timeout?: number;
};

/** More was held than may be. */
class TooMuchHeld extends Error {}

const EMPTY = Buffer.alloc(0);

async function holdAll(from: Reader, limit: number): Promise<Buffer> {
  const held: Buffer[] = [];
  let size = 0;
  for (let chunk = await from.read(); chunk != null; chunk = await from.read()) {
    held.push(chunk);
    size += chunk.length;
    if (size > limit) {
      throw new TooMuchHeld();
    }
  }
  return held.length === 0 ? EMPTY : Buffer.concat(held);
}

function readerOver(bytes: Buffer): Reader {
  let taken = bytes.length === 0;
  return {
    read: async () => {
      if (taken) {
        return undefined;
      }
      taken = true;
      return bytes;
    },
  };
}

/** Whether a stage follows the one before it, given how they were joined. */
function follows(op: Op | undefined, previous: Outcome | undefined): boolean {
  if (op == null || previous == null) {
    return true;
  }
  if (op === '&&') {
    return previous.kind === 'finished';
  }
  if (op === '||') {
    return previous.kind !== 'finished';
  }
  // A pipe starts both at once, so the producer's fate is not yet known and cannot be waited for.
  // What stops the reader is there being nothing to read from at all.
  return previous.kind !== 'skipped' && previous.kind !== 'refused';
}

type Started = { report: StageReport; running: Running; out: Channel; failed: () => unknown };

export async function run(stages: Stage[], options: RunOptions): Promise<RunResult> {
  const reports: StageReport[] = [];
  const started: Started[] = [];
  const expiry = new AbortController();
  let timedOut = false;
  let done = false;

  // Time running out closes whatever is open, so a read that would never end does.
  if (options.timeout != null) {
    void options.sleep(options.timeout, expiry.signal).then(() => {
      if (!done) {
        timedOut = true;
        expiry.abort();
      }
    });
  }

  let upstream: Reader | undefined;
  let previous: Outcome | undefined;
  let previousOp: Op | undefined;
  let output = EMPTY;

  for (const stage of stages) {
    if (stage.kind !== 'tool') {
      continue;
    }

    if (!follows(previousOp, previous)) {
      previous = { kind: 'skipped' };
      previousOp = stage.op;
      reports.push({ name: stage.tool.name, ended: previous });
      upstream = undefined;
      continue;
    }

    const decided = await decide(stage, upstream, options);
    if (decided.refused != null) {
      previous = decided.refused;
      previousOp = stage.op;
      reports.push({ name: stage.tool.name, ended: previous });
      upstream = undefined;
      continue;
    }

    const out = channel(options.ahead);
    // A stage that fails is recorded here rather than thrown at its reader: a reader sees the end,
    // the way it does when a process dies, and the failure belongs to the stage that had it.
    let failure: unknown;
    const running = stage.tool.run(stage.input, decided.source, {
      write: out.write,
      end: out.end,
      fail: (err) => {
        failure = err;
        out.end();
      },
    });
    if (expiry.signal.aborted) {
      out.close();
    } else {
      expiry.signal.addEventListener('abort', () => out.close(), { once: true });
    }
    const report: StageReport = { name: stage.tool.name, ended: { kind: 'finished' } };
    reports.push(report);
    started.push({ report, running, out, failed: () => failure });

    if (stage.op === '|') {
      // Both are alive: the next stage reads this one while it is still writing.
      upstream = out;
      previous = { kind: 'finished' };
      previousOp = stage.op;
      continue;
    }

    const taken = await take(out, options.hold);
    await settle(started, taken.tooMuch, timedOut);
    started.length = 0;
    previous = report.ended;
    previousOp = stage.op;
    upstream = undefined;
    output = taken.bytes;
  }

  await settle(started, false, timedOut);
  done = true;
  expiry.abort();
  return { output, stages: reports };
}

async function decide(stage: ToolStage, upstream: Reader | undefined, options: RunOptions): Promise<{ source?: Reader; refused?: Outcome }> {
  let shown: Buffer | undefined;

  try {
    const outcome = await options.decide({
      name: stage.tool.name,
      operations: stage.tool.operations(stage.input),
      input: stage.input,
      batch: async () => {
        shown ??= upstream == null ? EMPTY : await holdAll(upstream, options.hold);
        return shown;
      },
    });
    if (outcome.verdict === 'refuse') {
      return { refused: { kind: 'refused', ...(outcome.reason != null ? { reason: outcome.reason } : {}) } };
    }
  } catch (err) {
    if (!(err instanceof TooMuchHeld)) {
      throw err;
    }
    // Half of what a stage would act on is not something anyone can decide about.
    return { refused: { kind: 'refused', reason: 'more was piped in than can be held to be shown' } };
  }

  return { source: shown != null ? readerOver(shown) : upstream };
}

async function take(out: Channel, limit: number): Promise<{ bytes: Buffer; tooMuch: boolean }> {
  try {
    return { bytes: await holdAll(out, limit), tooMuch: false };
  } catch (err) {
    if (err instanceof TooMuchHeld) {
      return { bytes: EMPTY, tooMuch: true };
    }
    throw err;
  }
}

/** Every stage still open behind the current point: stopped, then asked how it went. */
async function settle(open: Started[], tooMuch: boolean, timedOut: boolean): Promise<void> {
  for (let index = open.length - 1; index >= 0; index--) {
    const stage = open[index] as Started;
    stage.out.close();
    await stage.running.stop();
    const failure = stage.failed();
    stage.report.ended = failure !== undefined ? { kind: 'threw', error: failure } : tooMuch ? { kind: 'truncated' } : timedOut ? { kind: 'timedOut' } : stage.running.ended();
  }
}
