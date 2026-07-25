/** A lazy, pull-based sequence — the same shape a real OS pipe gives you for free, but ours
 *  since a tool's "pipe" is relayed through us, not a direct fd-to-fd kernel connection (see
 *  the design doc: real pipes give no interception point for approval, so relaying is required). */
export type Stream<T> = AsyncGenerator<T, void, unknown>;

/** Filesystem permission tiers, named after Unix's own model — `list` (directory entries) is
 *  kept distinct from `read` (file content), the same way `r` on a directory differs from `r`
 *  on a file. `escalate` (crossing a privilege boundary) is deliberately not part of this set:
 *  it isn't a filesystem operation at all. */
export type FsOperation = 'fs.list' | 'fs.read' | 'fs.write' | 'fs.delete' | 'fs.exec';

/** What a leaf hands back: its real content (stdout — flows to the next stage, or becomes what
 *  the caller sees if nothing consumes it further) and a settle-able success flag, read only
 *  after stdout is fully drained. `stderr` is not a field here — it's a mutable array the
 *  *caller* passes into `run`, so the leaf never decides whether it's shown; that policy lives
 *  entirely in `execute`, not in any leaf. */
export type LeafResult<TOut> = {
  stdout: Stream<TOut>;
  success: () => boolean;
};

/** One node in an orchestration. `operation` drives gating (see `plan`): `'none'` never needs
 *  approval and is always safe to stream; any `FsOperation` is gated unless its tier is already
 *  granted for this run. `showStderr` opts a leaf into always surfacing its stderr even on
 *  success (the git-shaped case — real content lands on stderr even when nothing went wrong);
 *  stderr is always shown automatically on failure regardless of this flag. */
export type Leaf<TIn, TOut> = {
  name: string;
  operation: 'none' | FsOperation;
  showStderr?: boolean;
  run: (input: TIn, upstream: Stream<unknown> | AsyncIterable<unknown> | undefined, stderr: string[]) => LeafResult<TOut>;
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
  operation: Leaf<unknown, unknown>['operation'];
  mode: 'stream' | 'buffer-then-gate';
};

/** A real leaf/tool call stage. */
export type LeafStage = { kind: 'leaf'; leaf: Leaf<unknown, unknown>; input: Record<string, unknown>; op?: Op; captureAs?: string };

/** Bridges a stream into a named parameter of the NEXT stage's input, entirely from outside
 *  that stage — the target leaf needs zero stream-handling code of its own (see the design
 *  doc's Xargs section: this is what lets an unmodified external/MCP tool be fed by a stream). */
export type XargsStage = { kind: 'xargs'; parameter: string };

export type Stage = LeafStage | XargsStage;

export type StageReport = {
  name: string;
  ran: boolean;
  success: boolean | null;
  stderrShown: string[] | null;
};
