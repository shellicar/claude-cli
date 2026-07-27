/** A lazy, pull-based sequence — the same shape a real OS pipe gives you for free, but ours
 *  since a tool's "pipe" is relayed through us, not a direct fd-to-fd kernel connection (see
 *  the design doc: real pipes give no interception point for approval, so relaying is required). */
export type Stream<T> = AsyncGenerator<T, void, unknown>;

/** Filesystem permission tiers, named after Unix's own model — `list` (directory entries) is
 *  kept distinct from `read` (file content), the same way `r` on a directory differs from `r`
 *  on a file. `escalate` (crossing a privilege boundary) is deliberately not part of this set:
 *  it isn't a filesystem operation at all. */
export type FsOperation = 'fs.list' | 'fs.read' | 'fs.write' | 'fs.delete' | 'fs.exec';

/** What a tool hands back: its real content (stdout — flows to the next stage, or becomes what
 *  the caller sees if nothing consumes it further) and a settle-able success flag, read only
 *  after stdout is fully drained. `stderr` is not a field here — it's a mutable array the
 *  *caller* passes into `run`, so the tool never decides whether it's shown; that policy lives
 *  entirely in `execute`, not in any tool. */
export type ToolV2Result<TOut> = {
  stdout: Stream<TOut>;
  success: () => boolean;
};

/** A tool Orchestrate can run — the same concept as a V1 tool (`defineTool`), built to a
 *  streaming/composable contract instead of a single request/response. Orchestrate is not a
 *  tool that encapsulates a fixed set of these; it's a tool that can run *any* registered one.
 *  `operation` drives gating (see `plan`): `'none'` never needs approval and is always safe to
 *  stream; any `FsOperation` is gated unless its tier is already granted for this run. */
export type ToolV2<TIn, TOut> = {
  name: string;
  operation: 'none' | FsOperation;
  /** `signal` is handed to every tool unconditionally; whether a given tool actually reacts to
   *  it is that tool's own business — orchestrate never drives a tool's cancellation itself, it
   *  only stops advancing to further stages once the signal is aborted (see `execute`). */
  run: (input: TIn, upstream: Stream<unknown> | AsyncIterable<unknown> | undefined, stderr: string[], signal?: AbortSignal) => ToolV2Result<TOut>;
};

/** Forward-pointing join to the NEXT stage, same convention as ExecV3: absent means sequential
 *  (bash `;` — run next regardless, no data flows). Only `'|'` pipes this stage's drained stdout
 *  into the next stage's upstream; `'&&'`/`'||'` gate on success/failure but pass no data — the
 *  bug this module's tests exist to pin down (an earlier POC pass forwarded stdout unconditionally,
 *  which would have handed `git rebase` fetch's output as stdin). */
export type Op = '|' | '&&' | '||';

/** What's approved for this run — which `FsOperation` tiers are pre-trusted, decided before
 *  execution starts and never revised mid-run. */
export type ApprovalGrant = { tiers: Set<FsOperation> };

export type PlannedStage = {
  name: string;
  operation: ToolV2<unknown, unknown>['operation'];
  mode: 'stream' | 'buffer-then-gate';
};

/** A real tool-call stage. `showStderr` opts THIS stage into always surfacing its stderr even
 *  on success (the git-shaped case — real content lands on stderr even when nothing went
 *  wrong; `gzip -v`'s progress is another). It's a property of what the caller wants from this
 *  specific invocation in this specific orchestration, not of the tool itself — any node can
 *  write meaningful stderr, and the same tool might want it shown in one call and hidden in
 *  another. Stderr is always shown automatically on failure regardless of this flag. */
export type ToolStage = { kind: 'tool'; tool: ToolV2<unknown, unknown>; input: Record<string, unknown>; op?: Op; captureAs?: string; showStderr?: boolean };

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
  stderrShown: string[] | null;
  /** Only ever set when `outcome === 'denied'` — the reason a refusal wasn't a silent or
   *  unexplained one. */
  message?: string;
};
