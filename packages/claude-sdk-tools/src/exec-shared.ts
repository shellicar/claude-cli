import { createWriteStream } from 'node:fs';
import { PassThrough, type Writable } from 'node:stream';
import { Executor } from '@shellicar/exec-core';

/**
 * One Executor for the process. Its exit-sweep handler registers once, here,
 * rather than per tool or per call. Tests construct their own Executor.
 */
export const executor = new Executor();

/**
 * Combine a parent cancellation signal with an optional timeout into a single
 * AbortSignal. Both pieces are native (AbortSignal.timeout, AbortSignal.any);
 * this just does the "tool cancel plus timeout" composition both exec tools need.
 */
export function execSignal(parent: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (parent) {
    signals.push(parent);
  }
  if (timeoutMs != null) {
    signals.push(AbortSignal.timeout(timeoutMs));
  }
  if (signals.length === 0) {
    return undefined;
  }
  if (signals.length === 1) {
    return signals[0];
  }
  return AbortSignal.any(signals);
}

interface OutputRouting {
  redirect?: { path: string; stream: 'stdout' | 'stderr' | 'both'; append?: boolean };
  merge_stderr?: boolean;
}

export interface Sinks {
  stdout: Writable;
  stderr: Writable;
  /** Present when stdout should be collected for the result (no redirect, no downstream sink). */
  stdoutCapture?: PassThrough;
  /** Present when stderr should be collected for the result (not merged, not redirected). */
  stderrCapture?: PassThrough;
}

/**
 * Decide where a command's stdout and stderr go from its redirect/merge config.
 *
 * `stdoutDest` is where stdout goes when it is not redirected — a downstream
 * bridge for a pipe stage, or omitted for a terminal command (in which case a
 * capture stream is created). `merge_stderr` points stderr at stdout's
 * destination; a redirect points either at a file. Returns the sinks plus the
 * capture streams the caller should collect.
 */
export function resolveSinks(cmd: OutputRouting, stdoutDest?: Writable): Sinks {
  const redirect = cmd.redirect;
  const file = redirect ? createWriteStream(redirect.path, { flags: redirect.append ? 'a' : 'w' }) : undefined;
  file?.on('error', () => {
    // Redirect write errors should not crash the run.
  });

  let stdout: Writable;
  let stdoutCapture: PassThrough | undefined;
  if (redirect && file && (redirect.stream === 'stdout' || redirect.stream === 'both')) {
    stdout = file;
  } else if (stdoutDest) {
    stdout = stdoutDest;
  } else {
    stdoutCapture = new PassThrough();
    stdout = stdoutCapture;
  }

  let stderr: Writable;
  let stderrCapture: PassThrough | undefined;
  if (cmd.merge_stderr) {
    stderr = stdout;
  } else if (redirect && file && (redirect.stream === 'stderr' || redirect.stream === 'both')) {
    stderr = file;
  } else {
    stderrCapture = new PassThrough();
    stderr = stderrCapture;
  }

  return { stdout, stderr, stdoutCapture, stderrCapture };
}
