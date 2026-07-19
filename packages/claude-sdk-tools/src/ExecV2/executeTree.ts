import { PassThrough, Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { fromStream, type IExecutor } from '@shellicar/exec-core';
import { resolveSinks } from '../exec-shared';
import type { Command, CommandResult, Pipeline } from './types';

export interface ExecContext {
  cwd: string;
  signal?: AbortSignal;
  executor: IExecutor;
  fs: IFileSystem;
}

type Aggregated = [CommandResult[], number | null];

function specOf(cmd: Command, ctx: ExecContext) {
  return {
    program: cmd.program,
    args: cmd.args,
    cwd: cmd.cwd ?? ctx.cwd,
    env: { ...process.env, ...cmd.env },
  };
}

function stdinOf(cmd: Command): Readable | undefined {
  return cmd.stdin != null ? Readable.from(cmd.stdin) : undefined;
}

/** Unguarded combine (`;`, `&`): either side failing makes the whole non-zero. */
function combineUnguarded(leftExit: number | null, rightExit: number | null): number | null {
  return leftExit !== 0 ? leftExit : rightExit;
}

/** Run one command to completion, routing and capturing its output. */
async function runLeaf(cmd: Command, ctx: ExecContext): Promise<Aggregated> {
  const { stdout, stderr, stdoutCapture, stderrCapture } = resolveSinks(cmd, ctx.fs);
  const [status, out, err] = await Promise.all([ctx.executor.run(specOf(cmd, ctx), { stdin: stdinOf(cmd), stdout, stderr, signal: ctx.signal }), stdoutCapture ? fromStream(stdoutCapture) : Promise.resolve(''), stderrCapture ? fromStream(stderrCapture) : Promise.resolve('')]);
  return [[{ id: cmd.id, stdout: out, stderr: err, exitCode: status.exitCode, signal: status.signal }], status.exitCode];
}

/** Execute a Pipeline, collecting each leaf's output. Returns [results, aggregate exit]. */
export async function executeTree(pipeline: Pipeline, ctx: ExecContext): Promise<Aggregated> {
  if ('program' in pipeline) {
    return runLeaf(pipeline, ctx);
  }

  const op = pipeline.op;

  if (op === ';') {
    const [lr, le] = await executeTree(pipeline.left, ctx);
    const [rr, re] = await executeTree(pipeline.right, ctx);
    return [[...lr, ...rr], combineUnguarded(le, re)];
  }

  if (op === '&&') {
    const [lr, le] = await executeTree(pipeline.left, ctx);
    if (le === 0) {
      const [rr, re] = await executeTree(pipeline.right, ctx);
      return [[...lr, ...rr], re];
    }
    return [lr, le];
  }

  if (op === '||') {
    const [lr, le] = await executeTree(pipeline.left, ctx);
    if (le !== 0) {
      const [rr, re] = await executeTree(pipeline.right, ctx);
      return [[...lr, ...rr], re];
    }
    return [lr, le];
  }

  if (op === '&') {
    const [lo, ro] = await Promise.all([executeTree(pipeline.left, ctx), executeTree(pipeline.right, ctx)]);
    return [[...lo[0], ...ro[0]], combineUnguarded(lo[1], ro[1])];
  }

  if (op === '|') {
    return executePipe(pipeline.left, pipeline.right, ctx);
  }

  throw new Error(`Unknown op: ${op as string}`);
}

/**
 * Terminal pipe: the left side feeds a bridge (via pump), the right reads it and
 * its stdout is captured for the result.
 */
async function executePipe(left: Pipeline, right: Pipeline, ctx: ExecContext): Promise<Aggregated> {
  if (!('program' in right)) {
    throw new Error(`Operation as the right side of a pipe is not supported yet (op: ${right.op})`);
  }

  const bridge = new PassThrough();
  const leftP = pump(left, bridge, ctx).then((agg) => {
    bridge.end();
    return agg;
  });

  const { stdout, stderr, stdoutCapture, stderrCapture } = resolveSinks(right, ctx.fs);
  const rightP = Promise.all([ctx.executor.run(specOf(right, ctx), { stdin: bridge, stdout, stderr, signal: ctx.signal }), stdoutCapture ? fromStream(stdoutCapture) : Promise.resolve(''), stderrCapture ? fromStream(stderrCapture) : Promise.resolve('')]);

  const [leftResults] = await leftP;
  const [rStatus, rOut, rErr] = await rightP;

  const all = [...leftResults, { id: right.id, stdout: rOut, stderr: rErr, exitCode: rStatus.exitCode, signal: rStatus.signal }];
  const anyFailed = all.some((r) => r.exitCode !== 0);
  return [all, anyFailed ? 1 : rStatus.exitCode];
}

/**
 * Run a pipeline as a pipe source, forwarding every leaf's stdout into `sink`
 * without ending it (the caller owns sink's lifetime). A command forwards via a
 * per-command PassThrough so a shared sink (a subtree feeding one consumer) isn't
 * closed by whichever leaf finishes first. Operators recurse, preserving their
 * semantics; a nested pipe threads its own inner bridge.
 *
 * `stdin` overrides the command's own stdin — used to thread a pipe into the head.
 */
async function pump(pipeline: Pipeline, sink: PassThrough, ctx: ExecContext, stdin?: Readable): Promise<Aggregated> {
  if ('program' in pipeline) {
    const fwd = new PassThrough();
    fwd.pipe(sink, { end: false });
    const { stdout, stderr, stderrCapture } = resolveSinks(pipeline, ctx.fs, fwd);
    const fwdUsed = stdout === fwd; // a redirect can divert stdout away from fwd
    const [status, err] = await Promise.all([ctx.executor.run(specOf(pipeline, ctx), { stdin: stdin ?? stdinOf(pipeline), stdout, stderr, signal: ctx.signal }), stderrCapture ? fromStream(stderrCapture) : Promise.resolve(''), fwdUsed ? finished(fwd).catch(() => undefined) : Promise.resolve(undefined)]);
    if (!fwdUsed) {
      fwd.end();
    }
    return [[{ id: pipeline.id, stdout: '', stderr: err, exitCode: status.exitCode, signal: status.signal }], status.exitCode];
  }

  const op = pipeline.op;

  if (op === '|') {
    if (!('program' in pipeline.right)) {
      throw new Error(`Operation as the right side of a pipe is not supported yet (op: ${pipeline.right.op})`);
    }
    const bridge = new PassThrough();
    const leftP = pump(pipeline.left, bridge, ctx).then((agg) => {
      bridge.end();
      return agg;
    });
    const [rightResults, rightExit] = await pump(pipeline.right, sink, ctx, bridge);
    const [leftResults] = await leftP;
    const all = [...leftResults, ...rightResults];
    const anyFailed = all.some((r) => r.exitCode !== 0);
    return [all, anyFailed ? 1 : rightExit];
  }

  if (op === ';') {
    const [lr, le] = await pump(pipeline.left, sink, ctx);
    const [rr, re] = await pump(pipeline.right, sink, ctx);
    return [[...lr, ...rr], combineUnguarded(le, re)];
  }

  if (op === '&&') {
    const [lr, le] = await pump(pipeline.left, sink, ctx);
    if (le === 0) {
      const [rr, re] = await pump(pipeline.right, sink, ctx);
      return [[...lr, ...rr], re];
    }
    return [lr, le];
  }

  if (op === '||') {
    const [lr, le] = await pump(pipeline.left, sink, ctx);
    if (le !== 0) {
      const [rr, re] = await pump(pipeline.right, sink, ctx);
      return [[...lr, ...rr], re];
    }
    return [lr, le];
  }

  if (op === '&') {
    const [lo, ro] = await Promise.all([pump(pipeline.left, sink, ctx), pump(pipeline.right, sink, ctx)]);
    return [[...lo[0], ...ro[0]], combineUnguarded(lo[1], ro[1])];
  }

  throw new Error(`Unknown op: ${op as string}`);
}

/** Walk the tree and return every Command leaf in pre-order. */
export function collectLeaves(pipeline: Pipeline): Command[] {
  if ('program' in pipeline) {
    return [pipeline];
  }
  return [...collectLeaves(pipeline.left), ...collectLeaves(pipeline.right)];
}
