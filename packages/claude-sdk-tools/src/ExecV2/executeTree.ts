import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import type { Readable, Writable } from 'node:stream';
import type { Command, CommandResult, Pipeline } from './types';

export interface ExecContext {
  cwd: string;
  timeout?: number;
}

type ResultFields = Omit<CommandResult, 'id'>;
type Aggregated = [CommandResult[], number | null];

interface SpawnOpts {
  /** When set, this stream is piped into the child's stdin (literal `stdin` is ignored). */
  stdinStream?: Readable;
  /**
   * When set, the child's stdout flows into this sink with `{ end: false }`, and no
   * capture listener is attached on stdout. The caller controls when to end the sink —
   * a single sink may receive output from several children (e.g. `(a; b) | c`).
   */
  stdoutSink?: Writable;
}

/**
 * Low-level spawn for one Command. Returns the spawned ChildProcess (or `null` when no
 * process was spawned because the working directory was not found) plus a Promise that
 * resolves with the captured result fields.
 *
 * The cwd existence check happens before spawn for the same reason V1 does it: spawning
 * with a missing cwd surfaces as a generic ENOENT 'error' event whose default message
 * conflates it with command-not-found. The explicit check gives us a distinct
 * `exitCode: 126` and a "Working directory not found" stderr that the tests can match.
 */
function spawnNode(cmd: Command, ctx: ExecContext, opts: SpawnOpts): { child: ChildProcess | null; result: Promise<ResultFields> } {
  const resolvedCwd = cmd.cwd ?? ctx.cwd;
  if (!existsSync(resolvedCwd)) {
    return {
      child: null,
      result: Promise.resolve({
        stdout: '',
        stderr: `Working directory not found: ${resolvedCwd}`,
        exitCode: 126,
        signal: null,
      }),
    };
  }

  const env: NodeJS.ProcessEnv = { ...process.env, ...cmd.env };
  const child = spawn(cmd.program, cmd.args ?? [], {
    cwd: resolvedCwd,
    env,
    stdio: 'pipe',
    timeout: ctx.timeout,
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  const redirectingStdout = cmd.redirect && (cmd.redirect.stream === 'stdout' || cmd.redirect.stream === 'both');
  const redirectingStderr = cmd.redirect && (cmd.redirect.stream === 'stderr' || cmd.redirect.stream === 'both');

  if (opts.stdoutSink) {
    // Pipe-source mode: stdout (and optionally merged stderr) flow into the sink. No
    // capture listener is attached on stdout — the result entry will carry the empty
    // string, which is the V2 contract for "this leaf's bytes were consumed by a pipe".
    if (cmd.merge_stderr) {
      child.stdout.pipe(opts.stdoutSink, { end: false });
      child.stderr.pipe(opts.stdoutSink, { end: false });
    } else {
      child.stdout.pipe(opts.stdoutSink, { end: false });
      if (!redirectingStderr) {
        child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      }
    }
  } else {
    // Standalone (or right-of-pipe) capture mode. The right side of a pipe also lands
    // here — its stdin is overridden via `opts.stdinStream`, but its stdout is captured
    // normally (or redirected to a file if `cmd.redirect` is set, as in R3).
    if (!redirectingStdout) {
      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    }
    if (!redirectingStderr) {
      child.stderr.on('data', (chunk: Buffer) => (cmd.merge_stderr ? stdoutChunks : stderrChunks).push(chunk));
    }
    if (cmd.redirect) {
      const flags = cmd.redirect.append ? 'a' : 'w';
      const fileStream = createWriteStream(cmd.redirect.path, { flags });
      fileStream.on('error', () => {
        // Swallow redirect write errors; the redirect failing should not crash the process.
      });
      const target = cmd.redirect.stream;
      if (target === 'stdout' || target === 'both') child.stdout.pipe(fileStream);
      if (target === 'stderr' || target === 'both') child.stderr.pipe(fileStream);
    }
  }

  if (opts.stdinStream) {
    opts.stdinStream.pipe(child.stdin);
    child.stdin.on('error', () => {
      // Expected when the downstream process exits before the upstream finishes writing.
    });
  } else if (cmd.stdin !== undefined) {
    child.stdin.write(cmd.stdin);
    child.stdin.end();
  } else {
    child.stdin.end();
  }

  const result = new Promise<ResultFields>((resolve) => {
    child.on('close', (code, signal) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode: code,
        signal: signal ?? null,
      });
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        resolve({
          stdout: '',
          stderr: `Command not found: ${cmd.program}`,
          exitCode: 127,
          signal: null,
        });
      } else {
        resolve({
          stdout: '',
          stderr: err.message,
          exitCode: 1,
          signal: null,
        });
      }
    });
  });

  return { child, result };
}

/**
 * Execute a Pipeline tree and return [results in tree pre-order, aggregate exit code].
 *
 * The aggregate exit drives the short-circuit decisions on `&&` / `||` parents AND is
 * what the top-level caller turns into the envelope's `success` (`aggregate === 0`).
 * Using the aggregate rather than `results.every(...)` is what makes `||` work: the
 * left leaf's non-zero exit is still in `results`, but the right side handled it, so
 * the aggregate is zero and `success` is true (O2, M1).
 */
export async function executeTree(pipeline: Pipeline, ctx: ExecContext): Promise<Aggregated> {
  if ('program' in pipeline) {
    const { result } = spawnNode(pipeline, ctx, {});
    const r = await result;
    return [[{ id: pipeline.id, ...r }], r.exitCode];
  }

  const op = pipeline.op;

  if (op === ';') {
    // Both sides run unconditionally. The aggregate surfaces a failure on either side
    // — the test catalog (C2, M2) expects `;` to NOT mask a left-side failure even when
    // the right side succeeds. That diverges from shell `$?` semantics (which would be
    // right's exit) but it matches V2's `success` contract: the result is failed if any
    // unguarded leaf failed. `&&`/`||` are the only operators that "guard" a failure.
    const [leftResults, leftExit] = await executeTree(pipeline.left, ctx);
    const [rightResults, rightExit] = await executeTree(pipeline.right, ctx);
    return [[...leftResults, ...rightResults], combineUnguarded(leftExit, rightExit)];
  }

  if (op === '&&') {
    const [leftResults, leftExit] = await executeTree(pipeline.left, ctx);
    if (leftExit === 0) {
      const [rightResults, rightExit] = await executeTree(pipeline.right, ctx);
      return [[...leftResults, ...rightResults], rightExit];
    }
    return [leftResults, leftExit];
  }

  if (op === '||') {
    const [leftResults, leftExit] = await executeTree(pipeline.left, ctx);
    if (leftExit !== 0) {
      const [rightResults, rightExit] = await executeTree(pipeline.right, ctx);
      return [[...leftResults, ...rightResults], rightExit];
    }
    return [leftResults, leftExit];
  }

  if (op === '&') {
    // Concurrent. Both sides run in parallel; results land in tree pre-order regardless
    // of wall-clock completion order. Aggregate exit is zero iff both subtrees succeeded.
    const [leftOut, rightOut] = await Promise.all([executeTree(pipeline.left, ctx), executeTree(pipeline.right, ctx)]);
    const [leftResults, leftExit] = leftOut;
    const [rightResults, rightExit] = rightOut;
    return [[...leftResults, ...rightResults], combineUnguarded(leftExit, rightExit)];
  }

  if (op === '|') {
    return executePipe(pipeline.left, pipeline.right, ctx);
  }

  throw new Error(`Unknown op: ${op as string}`);
}

/**
 * Combine two aggregate exits in an "unguarded" operator (`;`, `&`, `|`): either side
 * failing makes the whole non-zero. Used for operators where a failure is NOT handled
 * by the structure itself (unlike `&&`/`||`, which are explicit guards).
 *
 * Returns left's exit when left failed (preserves its specific code for diagnostics),
 * otherwise right's exit. `null` (signal-killed) is treated as a failure.
 */
function combineUnguarded(leftExit: number | null, rightExit: number | null): number | null {
  if (leftExit !== 0) return leftExit;
  return rightExit;
}

/**
 * Pipe coordinator. The right side is spawned first so it is already reading from the
 * PassThrough by the time the left side starts writing. The left runs as a pipe source
 * (every leaf's stdout flows into the PassThrough). When the left subtree finishes the
 * PassThrough is ended, giving the right side EOF.
 *
 * Aggregate exit follows pipefail semantics — non-zero if any leaf in the chain failed.
 */
async function executePipe(left: Pipeline, right: Pipeline, ctx: ExecContext): Promise<Aggregated> {
  const pt = new PassThrough();

  const rightPromise = executeAsConsumer(right, pt, ctx);
  const [leftResults] = await executeAsSource(left, pt, ctx);
  pt.end();
  const [rightResults, rightExit] = await rightPromise;

  const all = [...leftResults, ...rightResults];
  // Pipefail: aggregate non-zero if any leaf failed. We use a plain `1` rather than the
  // first failing leaf's exit — `rightExit ?? 1` collapses to `0` when right exits zero
  // even though an earlier leaf failed (P3, ER3), which is the wrong signal.
  const anyFailed = all.some((r) => r.exitCode !== 0);
  return [all, anyFailed ? 1 : rightExit];
}

/**
 * Execute a Pipeline subtree as a pipe source: every Command leaf's stdout is routed to
 * the provided `sink`, and the leaf's result entry carries empty `stdout`. The caller is
 * responsible for ending the sink after this resolves — a single sink may receive output
 * from several leaves (e.g. `(a; b) | c`).
 *
 * The `|` branch handles the nested-pipe-as-source case (R5: `(A|B)|C` — when executing
 * the inner `(A|B)` as the source for outer `C`, the inner B is a "bridge" — it reads
 * from the inner PassThrough and writes to the outer sink).
 */
async function executeAsSource(pipeline: Pipeline, sink: Writable, ctx: ExecContext): Promise<Aggregated> {
  if ('program' in pipeline) {
    const { result } = spawnNode(pipeline, ctx, { stdoutSink: sink });
    const r = await result;
    return [[{ id: pipeline.id, stdout: '', stderr: r.stderr, exitCode: r.exitCode, signal: r.signal }], r.exitCode];
  }

  const op = pipeline.op;

  if (op === ';') {
    const [leftResults, leftExit] = await executeAsSource(pipeline.left, sink, ctx);
    const [rightResults, rightExit] = await executeAsSource(pipeline.right, sink, ctx);
    return [[...leftResults, ...rightResults], combineUnguarded(leftExit, rightExit)];
  }

  if (op === '&&') {
    const [leftResults, leftExit] = await executeAsSource(pipeline.left, sink, ctx);
    if (leftExit === 0) {
      const [rightResults, rightExit] = await executeAsSource(pipeline.right, sink, ctx);
      return [[...leftResults, ...rightResults], rightExit];
    }
    return [leftResults, leftExit];
  }

  if (op === '||') {
    const [leftResults, leftExit] = await executeAsSource(pipeline.left, sink, ctx);
    if (leftExit !== 0) {
      const [rightResults, rightExit] = await executeAsSource(pipeline.right, sink, ctx);
      return [[...leftResults, ...rightResults], rightExit];
    }
    return [leftResults, leftExit];
  }

  if (op === '&') {
    const [leftOut, rightOut] = await Promise.all([executeAsSource(pipeline.left, sink, ctx), executeAsSource(pipeline.right, sink, ctx)]);
    const [leftResults, leftExit] = leftOut;
    const [rightResults, rightExit] = rightOut;
    return [[...leftResults, ...rightResults], combineUnguarded(leftExit, rightExit)];
  }

  if (op === '|') {
    const innerPt = new PassThrough();
    const rightPromise = executeAsBridge(pipeline.right, innerPt, sink, ctx);
    const [leftResults] = await executeAsSource(pipeline.left, innerPt, ctx);
    innerPt.end();
    const [rightResults, rightExit] = await rightPromise;
    const all = [...leftResults, ...rightResults];
    const anyFailed = all.some((r) => r.exitCode !== 0);
    return [all, anyFailed ? 1 : rightExit];
  }

  throw new Error(`Unknown op: ${op as string}`);
}

/**
 * Execute a Pipeline as a pipe consumer: the executed leaf receives `stdinStream` as its
 * stdin and captures stdout normally (subject to its own redirect). The current scenario
 * catalog only has Commands on the right side of `|`; an Operation here would need stdin
 * threaded to the first-executed leaf within the subtree.
 */
async function executeAsConsumer(pipeline: Pipeline, stdinStream: Readable, ctx: ExecContext): Promise<Aggregated> {
  if ('program' in pipeline) {
    const { result } = spawnNode(pipeline, ctx, { stdinStream });
    const r = await result;
    return [[{ id: pipeline.id, ...r }], r.exitCode];
  }
  throw new Error(`Operation as the right side of a pipe is not supported yet (op: ${pipeline.op})`);
}

/**
 * Execute a Pipeline as a bridge: stdin from `pipeIn`, stdout into `pipeOut`. Used for
 * the inner right-hand Command in a nested pipe (R5: `(A|B)|C` — B is the bridge).
 * Bridge leaves carry empty `stdout` in their result entry.
 */
async function executeAsBridge(pipeline: Pipeline, pipeIn: Readable, pipeOut: Writable, ctx: ExecContext): Promise<Aggregated> {
  if ('program' in pipeline) {
    const { result } = spawnNode(pipeline, ctx, { stdinStream: pipeIn, stdoutSink: pipeOut });
    const r = await result;
    return [[{ id: pipeline.id, stdout: '', stderr: r.stderr, exitCode: r.exitCode, signal: r.signal }], r.exitCode];
  }
  throw new Error(`Operation as a pipe bridge is not supported yet (op: ${pipeline.op})`);
}

/**
 * Walk the tree and return every Command leaf in pre-order. Used to feed `builtinRules`
 * (which is leaf-shape, not tree-shape) and to apply path normalisation.
 */
export function collectLeaves(pipeline: Pipeline): Command[] {
  if ('program' in pipeline) return [pipeline];
  return [...collectLeaves(pipeline.left), ...collectLeaves(pipeline.right)];
}
