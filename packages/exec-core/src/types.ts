import type { Readable, Writable } from 'node:stream';

/** A fully-resolved command to execute. No defaults, no inheritance — what you pass is what runs. */
export interface CommandSpec {
  program: string;
  args?: string[];
  /** Resolved working directory. Required — no fallback. */
  cwd: string;
  /** Complete process environment. Required — no merging with process.env here. */
  env: NodeJS.ProcessEnv;
}

/** What the process exits with. */
export interface ExitStatus {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Where each of the child's standard streams is wired. The caller provides the
 * destinations; run does no capturing of its own.
 */
export interface SpawnOpts {
  /** Source piped into the child's stdin. Absent → stdin is closed immediately. */
  stdin?: Readable;
  /** Destination for the child's stdout. Absent → drained. Same Writable as stderr → merged. */
  stdout?: Writable;
  /** Destination for the child's stderr. Absent → drained. */
  stderr?: Writable;
  /** When aborted, the process group is killed (SIGTERM → SIGKILL after a grace period). */
  signal?: AbortSignal;
}

/** The contract the tool layer depends on. Executor is one implementation. */
export interface IExecutor {
  run(cmd: CommandSpec, opts?: SpawnOpts): Promise<ExitStatus>;
}
