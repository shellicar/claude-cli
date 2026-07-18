import { createWriteStream } from 'node:fs';
import { PassThrough, type Writable } from 'node:stream';
import { Executor } from '@shellicar/exec-core';

/**
 * One Executor for the process. Its exit-sweep handler registers once, here,
 * rather than per tool or per call. Tests construct their own Executor.
 */
export const executor = new Executor();

/** The contract the tool layer depends on for building a child process's environment.
 *  One implementation (app-side `EnvProvider`) strips ambient credentials and injects an
 *  unprivileged one from secrets; tests can supply a trivial pass-through. */
export abstract class IEnvProvider {
  public abstract buildEnv(cmdEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
}

/** A strip+provide env transform. `cmdEnv` (the tool call's own per-command env, model-controlled)
 *  is merged FIRST, over `process.env`. `strip` then deletes its keys from that merged result, so a
 *  caller-supplied value cannot survive by riding in through cmdEnv. `provide` is applied LAST,
 *  overwriting whatever is there, so the identity a provider forces always wins, no matter what the
 *  caller passed.
 *
 *  This ordering is load-bearing: a model driving `ExecV3` controls `cmdEnv` directly (`commands[].env`
 *  on the tool's own input schema). An earlier version merged cmdEnv last, which let a model-supplied
 *  `GH_TOKEN` override the agent's forced unprivileged identity — confirmed exploitable (a bogus token
 *  produced GitHub's 401 instead of the agent token's 403, proving the caller's value had won). Never
 *  let `provide` run before `cmdEnv` is merged in.
 *
 *  Each provider owns its own strip/provide list (see `EnvProvider` for gh) rather than a shared
 *  "protected keys" constant: the provider is the authority on which vars its own CLI honors (gh reads
 *  both `GH_TOKEN` and `GITHUB_TOKEN`, for instance), so the guarantee travels with the provider that
 *  knows it, and doesn't rot when a new provider is added elsewhere without updating a shared list. */
export type EnvProviderConfig = { strip: string[]; provide: Record<string, () => string> };

export function buildEnvFrom(config: EnvProviderConfig, cmdEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...cmdEnv };
  for (const key of config.strip) {
    delete env[key];
  }
  for (const [key, resolve] of Object.entries(config.provide)) {
    env[key] = resolve();
  }
  return env;
}

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
