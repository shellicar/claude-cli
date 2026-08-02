import { type Channel, channel } from './channel.js';
import type { Ended, Op, Reader, Running, Stage, ToolStage } from './types.js';

/** How a stage ended: what its tool said, or what the run had to say instead. */
export type Outcome = Ended | { kind: 'refused'; reason?: string } | { kind: 'skipped' } | { kind: 'threw'; error: unknown } | { kind: 'truncated' } | { kind: 'timedOut' } | { kind: 'cancelled' };

export type StageReport = {
  name: string;
  ended: Outcome;
  /** What the stage had to say to whoever asked for the run. */
  said: string[];
  /** What the stage sent back that is not text. */
  attached: { bytes: Buffer; type: string }[];
};

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
  signal?: AbortSignal;
  /** Where a name bound to a stage's output goes. */
  bind?: (name: string, value: string) => void;
  /** How bytes become an argument list. */
  split?: (bytes: Buffer) => string[];
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
  return previous.kind !== 'skipped' && previous.kind !== 'refused' && previous.kind !== 'cancelled';
}

type Started = { report: StageReport; running: Running; out: Channel; failed: () => unknown; captured: string[]; showCaptured: 'onError' | 'always' | 'never' };

const defaultSplit = (bytes: Buffer): string[] =>
  bytes
    .toString('utf8')
    .split('\n')
    .filter((argument) => argument.length > 0);

export async function run(stages: Stage[], options: RunOptions): Promise<RunResult> {
  const reports: StageReport[] = [];
  const started: Started[] = [];
  const expiry = new AbortController();
  const split = options.split ?? defaultSplit;
  let timedOut = false;
  let cancelled = options.signal?.aborted === true;
  let done = false;

  // Time running out, or the caller saying stop, closes whatever is open: a read that would never
  // end does, and the stage behind it is told the only way a stage is ever told.
  if (options.timeout != null) {
    void options.sleep(options.timeout, expiry.signal).then(() => {
      if (!done) {
        timedOut = true;
        expiry.abort();
      }
    });
  }
  options.signal?.addEventListener(
    'abort',
    () => {
      cancelled = true;
      expiry.abort();
    },
    { once: true },
  );

  let upstream: Reader | undefined;
  let previous: Outcome | undefined;
  let previousOp: Op | undefined;
  let pendingList: string[] | undefined;
  let output = EMPTY;

  for (const stage of stages) {
    if (stage.kind === 'set') {
      const held = upstream == null ? undefined : await takeAll(upstream, options.hold);
      if (held?.bytes != null && !held.tooMuch) {
        options.bind?.(stage.name, held.bytes.toString('utf8'));
      }
      await settle(started, held?.tooMuch === true, timedOut, cancelled);
      started.length = 0;
      upstream = undefined;
      continue;
    }

    if (stage.kind === 'xargs') {
      const held = upstream == null ? undefined : await takeAll(upstream, options.hold);
      await settle(started, held?.tooMuch === true, timedOut, cancelled);
      started.length = 0;
      upstream = undefined;
      // Nothing collected, whether because there was nothing or because there was too much: either
      // way the stage after this one has no argument list, and a command with no arguments is a
      // different command.
      pendingList = held == null || held.tooMuch ? [] : split(held.bytes);
      previousOp = undefined;
      continue;
    }

    if (cancelled) {
      previous = { kind: 'cancelled' };
      reports.push({ name: stage.tool.name, ended: previous, said: [], attached: [] });
      previousOp = stage.op;
      upstream = undefined;
      continue;
    }

    const list = pendingList;
    const fedByList = list != null;
    pendingList = undefined;

    if (!follows(previousOp, previous) || (fedByList && list.length === 0)) {
      previous = { kind: 'skipped' };
      previousOp = stage.op;
      reports.push({ name: stage.tool.name, ended: previous, said: [], attached: [] });
      upstream = undefined;
      continue;
    }

    if (fedByList && stage.tool.takesListIn == null) {
      previous = { kind: 'refused', reason: `${stage.tool.name} takes no argument list` };
      previousOp = stage.op;
      reports.push({ name: stage.tool.name, ended: previous, said: [], attached: [] });
      upstream = undefined;
      continue;
    }

    const input = fedByList ? withList(stage.input, stage.tool.takesListIn as string, list) : stage.input;
    const decided = await decide(stage, input, upstream, options);
    if (decided.refused != null) {
      previous = decided.refused;
      previousOp = stage.op;
      reports.push({ name: stage.tool.name, ended: previous, said: [], attached: [] });
      upstream = undefined;
      continue;
    }

    const out = channel(options.ahead);
    // A stage that fails is recorded here rather than thrown at its reader: a reader sees the end,
    // the way it does when a process dies, and the failure belongs to the stage that had it.
    let failure: unknown;
    const said: string[] = [];
    const captured: string[] = [];
    const attached: { bytes: Buffer; type: string }[] = [];
    let saidBytes = 0;
    let attachedBytes = 0;
    const running = stage.tool.run(
      input,
      fedByList ? undefined : decided.source,
      {
        write: out.write,
        end: out.end,
        fail: (err) => {
          failure = err;
          out.end();
        },
      },
      (line, said_options) => {
        // Bounded like anything else held whole, and being cut short here is not the stage failing.
        if (saidBytes + line.length > options.hold) {
          return;
        }
        saidBytes += line.length;
        (said_options?.captured === true ? captured : said).push(line);
      },
      (bytes, type) => {
        if (attachedBytes + bytes.length > options.hold) {
          return;
        }
        attachedBytes += bytes.length;
        attached.push({ bytes, type });
      },
    );
    if (expiry.signal.aborted) {
      out.close();
    } else {
      expiry.signal.addEventListener('abort', () => out.close(), { once: true });
    }
    const report: StageReport = { name: stage.tool.name, ended: { kind: 'finished' }, said, attached };
    reports.push(report);
    started.push({ report, running, out, failed: () => failure, captured, showCaptured: stage.captured ?? 'onError' });

    if (stage.op === '|') {
      // Both are alive: the next stage reads this one while it is still writing.
      upstream = out;
      previous = { kind: 'finished' };
      previousOp = stage.op;
      continue;
    }

    const taken = await takeAll(out, options.hold);
    await settle(started, taken.tooMuch, timedOut, cancelled);
    started.length = 0;
    previous = report.ended;
    previousOp = stage.op;
    upstream = undefined;
    output = taken.bytes;
  }

  await settle(started, false, timedOut, cancelled);
  done = true;
  expiry.abort();
  return { output, stages: reports };
}

function withList(input: Record<string, unknown>, field: string, list: string[]): Record<string, unknown> {
  const existing = input[field];
  return { ...input, [field]: Array.isArray(existing) ? [...existing, ...list] : list };
}

async function decide(stage: ToolStage, input: Record<string, unknown>, upstream: Reader | undefined, options: RunOptions): Promise<{ source?: Reader; refused?: Outcome }> {
  let shown: Buffer | undefined;

  try {
    const outcome = await options.decide({
      name: stage.tool.name,
      operations: stage.tool.operations(input),
      input,
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

async function takeAll(from: Reader, limit: number): Promise<{ bytes: Buffer; tooMuch: boolean }> {
  try {
    return { bytes: await holdAll(from, limit), tooMuch: false };
  } catch (err) {
    if (err instanceof TooMuchHeld) {
      return { bytes: EMPTY, tooMuch: true };
    }
    throw err;
  }
}

/** Every stage still open behind the current point: stopped, then asked how it went. */
async function settle(open: Started[], tooMuch: boolean, timedOut: boolean, cancelled: boolean): Promise<void> {
  for (let index = open.length - 1; index >= 0; index--) {
    const stage = open[index] as Started;
    stage.out.close();
    await stage.running.stop();
    const failure = stage.failed();
    stage.report.ended = failure !== undefined ? { kind: 'threw', error: failure } : tooMuch ? { kind: 'truncated' } : cancelled ? { kind: 'cancelled' } : timedOut ? { kind: 'timedOut' } : stage.running.ended();
    // What a stage captured is worth reading when the stage did not finish cleanly, or when the
    // call said it wanted it. Otherwise it is a progress meter nobody asked for.
    if (stage.showCaptured === 'always' || (stage.showCaptured === 'onError' && stage.report.ended.kind !== 'finished')) {
      stage.report.said.push(...stage.captured);
    }
  }
}
