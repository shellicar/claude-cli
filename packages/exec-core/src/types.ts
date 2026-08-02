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

/**
 * One stage of a pipeline. A non-terminal stage has no `stdout` sink: its stdout is the
 * write end of a real pipe into the next stage, so the parent never sees those bytes.
 */
export interface PipelineStage {
  cmd: CommandSpec;
  /** Destination for this stage's stdout. Only a terminal stage has one. */
  stdout?: Writable;
  /** Destination for this stage's stderr. Absent → drained, or merged when `mergeStderr`. */
  stderr?: Writable;
  /** 2>&1 — stderr goes wherever stdout goes, including into the pipe. */
  mergeStderr?: boolean;
}

/** Options for the pipeline as a whole. Individual destinations belong to each stage. */
export interface PipelineOpts {
  /** Source piped into the first stage's stdin. Absent → stdin is closed immediately. */
  stdin?: Readable;
  /** When aborted, every stage's process group is killed. */
  signal?: AbortSignal;
}

/** The contract the tool layer depends on. Executor is one implementation. */
export interface IExecutor {
  run(cmd: CommandSpec, opts?: SpawnOpts): Promise<ExitStatus>;
  /**
   * Run stages as one pipeline over real OS pipes, stdout[i] feeding stdin[i+1]. Returns one
   * promise per stage, in stage order, each settling when that stage's process closes.
   * Returning the promises rather than awaiting them lets the caller time each stage itself.
   */
  runPipeline(stages: PipelineStage[], opts?: PipelineOpts): Promise<ExitStatus>[];
}
