/** A lazy, pull-based sequence — the same shape a real OS pipe gives you for free, but ours
 *  since a tool's "pipe" is relayed through us, not a direct fd-to-fd kernel connection (see
 *  the design doc: real pipes give no interception point for approval, so relaying is required). */
export type Stream<T> = AsyncGenerator<T, void, unknown>;

/** Filesystem permission tiers, named after Unix's own model — `list` (directory entries) is
 *  kept distinct from `read` (file content), the same way `r` on a directory differs from `r`
 *  on a file. Deliberately excludes `escalate` — see `Operation` below: `escalate` is a real
 *  operation category, just not a filesystem one, so it lives as a sibling, not a member of
 *  this set. */
export type FsOperation = 'fs.list' | 'fs.read' | 'fs.write' | 'fs.delete' | 'fs.exec';

/** Every operation category a `ToolV2` can declare: the `fs.*` tiers, plus `escalate` — a
 *  privilege-boundary crossing (credentials, holder tokens) that is never a filesystem
 *  operation and never a pre-trustable tier. Policy resolution doesn't care about this
 *  distinction at all (`operation` is just an opaque string key to it, see `Policy.resolve`);
 *  Future categories (e.g. `git.*`) join here the same way. */
export type Operation = 'none' | FsOperation | 'escalate';

/** What a tool hands back: its real content (stdout — flows to the next stage, or becomes what
 *  the caller sees if nothing consumes it further) and a settle-able success flag, read only
 *  after stdout is fully drained. `stderr` is not a field here — it's a mutable array the
 *  *caller* passes into `run`, so the tool never decides whether it's shown; that policy lives
 *  entirely in `execute`, not in any tool. */
export type ToolV2Result<TOut> = {
  stdout: Stream<TOut>;
  success: () => boolean;
  /** The signal this stage ended on, for a tool that can be signalled at all. A consumer that
   *  stops reading kills its producer, and `SIGPIPE` is what that is: not the tool going wrong,
   *  which is why it is reported as itself rather than folded into `success`. Read at the same
   *  moment as `success`. */
  signal?: () => string | null;
  /** Non-text output (e.g. a PDF/image content block) a tool wants delivered alongside its text
   *  result — opaque to orchestrate-core itself (it has no dependency on any SDK content-block
   *  type), read only after `stdout` is fully drained, same timing as `success`. Most tools never
   *  set this; `execute()` just collects whatever is here and hands it back uninterpreted. */
  attachments?: () => unknown[];
};

/** A tool Orchestrate can run — the same concept as a V1 tool (`defineTool`), built to a
 *  streaming/composable contract instead of a single request/response. Orchestrate is not a
 *  tool that encapsulates a fixed set of these; it's a tool that can run *any* registered one.
 *  `operation` says what this tool does to the world, and is carried to whoever decides. It does
 *  not decide anything itself: every stage is put to that decision, so no tool can exempt itself
 *  from being examined by what it declares about itself. */
export type ToolV2<TIn, TOut> = {
  name: string;
  /** What this call does to the world. A call, not the tool: `Program` executes, and it also writes
   *  when it redirects its output to a file, so the same tool answers differently for different
   *  input. Every one of them is decided on, and the strictest verdict governs, the same way a call
   *  naming several paths is judged one path at a time. */
  operations: (input: TIn) => Operation[];
  /** `signal` is handed to every tool unconditionally; whether a given tool actually reacts to
   *  it is that tool's own business — orchestrate never drives a tool's cancellation itself, it
   *  only stops advancing to further stages once the signal is aborted (see `execute`).
   *  `scope` is opaque here — this package has no dependency on any DI container — and is only
   *  ever the same per-batch value the caller passed into `execute()`'s own `scope` option; a
   *  tool with a genuinely per-batch-scoped dependency (e.g. a shared tsserver process) is the
   *  only kind that ever reads it, casting it back to its real type at its own boundary. */
  run: (input: TIn, upstream: Stream<unknown> | AsyncIterable<unknown> | undefined, stderr: string[], signal?: AbortSignal, scope?: unknown, env?: unknown) => ToolV2Result<TOut>;
};

/** Forward-pointing join to the NEXT stage, same convention as ExecV3: absent means sequential
 *  (bash `;` — run next regardless, no data flows). Only `'|'` pipes this stage's drained stdout
 *  into the next stage's upstream; `'&&'`/`'||'` gate on success/failure but pass no data — the
 *  bug this module's tests exist to pin down (an earlier POC pass forwarded stdout unconditionally,
 *  which would have handed `git rebase` fetch's output as stdin). */
export type Op = '|' | '&&' | '||';

/** A real tool-call stage. `showStderr` opts THIS stage into always surfacing its stderr even
 *  on success (the git-shaped case — real content lands on stderr even when nothing went
 *  wrong; `gzip -v`'s progress is another). It's a property of what the caller wants from this
 *  specific invocation in this specific orchestration, not of the tool itself — any node can
 *  write meaningful stderr, and the same tool might want it shown in one call and hidden in
 *  another. Stderr is always shown automatically on failure regardless of this flag. */
/** `prepare` settles the stage's input into the form it will actually act on, once anything an
 *  `Xargs` injected is in place: variables resolved against the run's environment, paths made
 *  absolute. It runs before the stage is judged, so a decision is about what will happen rather
 *  than about the text describing it — `$HOME/.ssh/id_rsa` is judged as the file it names, and a
 *  `-rf` arriving in a variable is judged as `-rf`. */
export type ToolStage = { kind: 'tool'; tool: ToolV2<unknown, unknown>; input: Record<string, unknown>; op?: Op; captureAs?: string; showStderr?: boolean; prepare?: (input: unknown, env?: unknown) => unknown };

/** Bridges a stream into a named parameter of the NEXT stage's input, entirely from outside
 *  that stage — the target tool needs zero stream-handling code of its own (see the design
 *  doc's Xargs section: this is what lets an unmodified external/MCP tool be fed by a stream). */
export type XargsStage = { kind: 'xargs'; parameter: string };

export type Stage = ToolStage | XargsStage;

/** 'ran' — actually executed (successfully or not, see `success`). 'denied' — evaluated, and
 *  actively refused (by policy or a human); never a control-flow decision, and always carries
 *  whatever `message` the refusal gave, if any. 'skipped' — never evaluated at all, because a
 *  prior `&&`/`||` decision or a denied/skipped upstream producer meant this stage was never
 *  reached. Denied and skipped are deliberately distinct: a denial is something that was
 *  actively refused, a skip is something that was never even attempted — collapsing them into
 *  one word erases exactly the distinction a caller needs to explain what happened. */
export type StageOutcome = 'ran' | 'denied' | 'skipped';

export type StageReport = {
  name: string;
  outcome: StageOutcome;
  success: boolean | null;
  /** How many values this stage produced, counted as they left it. `null` for a stage that never
   *  ran. It answers a question the final output cannot: a pipeline ending in nothing says nothing
   *  about which stage found nothing, and a stage in the middle is invisible entirely. */
  emitted: number | null;
  /** The signal the stage ended on, where there was one. `SIGPIPE` means its consumer stopped
   *  reading, which is the ordinary end of a producer in a pipeline. */
  signal: string | null;
  stderrShown: string[] | null;
  /** Only ever set when `outcome === 'denied'` — the reason a refusal wasn't a silent or
   *  unexplained one. */
  message?: string;
};
