import { PassThrough, type Writable } from 'node:stream';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
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

/**
 * A provider carrying its own variable overlay on top of a base one. Variables set here win over
 * everything the base builds, and exist only for as long as this instance does.
 *
 * This is what gives one Orchestrate run its own variable namespace: the run clones the ambient
 * provider, a `captureAs` stage writes its output into the clone, later stages read it — as a
 * `$NAME` substitution and as a real environment variable in any child process they spawn — and
 * the whole namespace dies with the run. Nothing a pipeline captures can leak into the next one,
 * or into the ambient environment, because the base is never written to.
 */
export class OverlayEnvProvider extends IEnvProvider {
  readonly #base: IEnvProvider;
  readonly #vars: Map<string, string>;

  public constructor(base: IEnvProvider, vars: Map<string, string> = new Map()) {
    super();
    this.#base = base;
    this.#vars = vars;
  }

  public buildEnv(cmdEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return { ...this.#base.buildEnv(cmdEnv), ...Object.fromEntries(this.#vars) };
  }

  public set(name: string, value: string): void {
    this.#vars.set(name, value);
  }

  public get(name: string): string | undefined {
    return this.#vars.get(name) ?? this.#base.buildEnv()[name];
  }

  /** A fresh overlay over the same base, carrying a copy of this one's variables. Writing to the
   *  copy never touches the original, so a nested run can add to what it inherited without the
   *  outer run seeing it. */
  public clone(): OverlayEnvProvider {
    return new OverlayEnvProvider(this.#base, new Map(this.#vars));
  }
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

/**
 * Names a call may not set for a process it spawns, because the engine will not honour them and a
 * command that runs with them quietly ignored is not the command that was asked for.
 *
 * Two groups. `PATH` and the loader and interpreter variables decide which file a program name
 * refers to and what code is loaded into it, so they change what a decision was even about: a rule
 * that allowed `git` means nothing if `git` is whatever the call put on the path. The credential
 * names are stripped from the ambient environment anyway, so a call setting one is asking for
 * something it will not get.
 *
 * A variable that redirects one specific program (`GIT_SSH_COMMAND` and its relatives) is not here:
 * that is the program doing what the program does, which is what a policy rule is for, and `env` is
 * matchable by name so a rule can name it.
 */
export const PROTECTED_ENV_NAMES = [
  'PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'SSH_AUTH_SOCK',
  'AZURE_CONFIG_DIR',
  'AZURE_EXTENSION_DIR',
  'AZURE_DEVOPS_EXT_PAT',
  'AZURE_CLIENT_SECRET',
  'AZURE_PASSWORD',
  'AZURE_CLIENT_CERTIFICATE_PATH',
] as const;

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
export function resolveSinks(cmd: OutputRouting, fs: IFileSystem, stdoutDest?: Writable): Sinks {
  const redirect = cmd.redirect;
  const file = redirect ? fs.createWriteStream(redirect.path, { flags: redirect.append ? 'a' : 'w' }) : undefined;
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
