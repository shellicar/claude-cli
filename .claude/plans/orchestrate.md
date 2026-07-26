# Orchestrate — Plan

Execution checklist. Reasoning and decisions live in `.claude/orchestrate-design.md` —
this file is only the phases and their status, so a new session can resume without
re-deriving the plan from chat history.

Tools V2: Orchestrate is a genuinely separate registration/approval system from the
existing `packages/claude-sdk` `ToolRegistry`/`ApprovalCoordinator`, not a tool bolted
onto it. See the design doc's "This is Tools V2" section for why. The whole catalogue
(every current tool, not a chosen few) is in scope to eventually become a Leaf — Pipe
is superseded entirely, not extended.

## Phase 1 — `packages/orchestrate-core` — DONE

The engine: `Leaf<TIn,TOut>`, `FsOperation` (`fs.list`/`fs.read`/`fs.write`/`fs.delete`/
`fs.exec`), `Op` (`|`/`&&`/`||`, absent = `;`), `plan()` (buffer-vs-stream per stage from
the live approval grant), `execute()` (gating, operator semantics, capture/reference,
Xargs bridging, centralized stderr policy), `XargsStage`. Real vitest specs, builds/
lints/type-checks clean.

## Phase 2 — Rewrite `Pipe`'s six stages as genuinely lazy leaves — DONE

`packages/claude-sdk-tools/src/Orchestrate/leaves/`: Find, Match, Head, Tail, Range,
Read, plus Program (the ExecV3/ExecV2 successor, backed by `@shellicar/exec-core`'s
real Executor). Real tests under `packages/claude-sdk-tools/test/Orchestrate/`, using
`MemoryFileSystem`/`FakeExecutor`, never real fs/processes. Full existing suite green
throughout.

## Phase 3 — Build the actual `Orchestrate` tool — IN PROGRESS

Wraps `orchestrate-core`, registered as its own thing per the Tools V2 decision — not
touching the existing `ToolRegistry`.

**Naming correction (SC caught this):** "Leaf" was never the settled name and implied a
tree structure the design explicitly rejects. Renamed throughout `orchestrate-core` and
`claude-sdk-tools`: `Leaf` → `ToolV2`, `LeafResult` → `ToolV2Result`, `LeafStage` →
`ToolStage` (`kind: 'leaf'` → `kind: 'tool'`), `createXLeaf` → `createXToolV2`, the
`leaves/` directory → `tools/`. These are tools — the same concept as a V1 tool, built to
a streaming contract. Orchestrate is not a tool that encapsulates a fixed set of them; it's
a tool that can run *any* registered one.

**Architecture correction (SC caught this too):** the first pass hand-wrote a second copy
of every tool's shape into a separate `wireSchema.ts`, kept "in lockstep by hand" with the
registry — two sources of truth for the same thing. Collapsed into one real
`ToolsV2Registry` (`registry.ts`): each tool is `defineToolV2`-shaped and self-describing
(carries its own zod `model`, like a V1 `ToolDefinition` carries its own schema). The
registry derives, from that one list:
- `wireTools: BetaTool[]` — every registered tool gets its own wire entry, same as V1's
  `Find`/`Paths` sources are both a pipe step and standalone-callable. This is the "it
  needs all the tools" point — a V2 tool is genuinely callable on its own, not only
  reachable through Orchestrate's stage array.
- `stageSchema` — the `Orchestrate` wire tool's `stages` array, a discriminated union
  built at construction time from every registered tool's own `model`. Generated, not
  hand-authored — no second schema to drift out of lockstep.
- `toStage(wire)` — resolves one wire stage into a real `orchestrate-core` `Stage`,
  validating that stage's `input` against its own tool's `model`.

Done so far, real code + tests, in `packages/claude-sdk-tools/src/Orchestrate/`:
- `defineToolV2.ts` — the V2 tool contract (name, description, operation, model, run),
  mirroring V1's `defineTool`/`ToolDefinition`.
- `tools/` — Find, Match, Head, Tail, Range, Read, Program, each `defineToolV2`-shaped.
- `registry.ts` — `ToolsV2Registry` / `createToolsV2Registry(deps)`, as above.
- `runOrchestrateCall.ts` — the one function a V2 dispatch path needs to call: raw
  `tool_use.input` in, `{ ok, content } | { ok, error }` out, matching V1's handler-result
  shape so the consumer doesn't need a second result taxonomy.
- Proven end-to-end (`test/Orchestrate/runOrchestrateCall.spec.ts`) against real tools:
  parse → resolve → `execute()` runs, and `execute()`'s existing `approve(stageName, batch)`
  hook already fires once per gated stage with no new engine work needed — confirmed via a
  scratch POC (`.claude/poc/orchestrate-tool-v2-dispatch.ts`) before writing the real files.

Still to do for Phase 3, the four touch points where V1 and V2 necessarily still connect
(Claude only ever sees one flat tool list):

1. **Wire tools list** — V1 and V2 tool definitions merge into the one array the API sees.
   Correction found while wiring this: the real merge point is NOT `IToolRegistry.wireTools`
   (that getter exists but `DurableConfigFactory.ts` notes the request path doesn't consume
   it) — it's `config.tools: AnyToolDefinition[]`, converted directly by `RequestBuilder`.
2. **Dispatch** — when a `tool_use` block comes back, something decides whether the name
   belongs to the V1 registry or the V2 engine.
3. **Tool rendering** — the TUI block needs to show both a V1 single result and a V2
   multi-stage orchestration result in one consistent shape.
4. **Approval UI/permissions** — SETTLED: V2 does not go through V1's permission matrix
   (`apps/claude-sdk-cli/src/permissions.ts` — the `PermissionAction.Approve/Ask/Deny` matrix
   zoned by cwd, keyed by `tool.operation`) at all. That system stays V1-only. V2 has its own
   permissions, driven entirely by `orchestrate-core`'s existing per-stage `fs.*` gating
   (`execute()`'s `approve(stageName, batch)` callback, already proven in Phase 3's work so
   far) — a separate, V2-only approval channel, not a shared component with
   `ApprovalCoordinator` or the permission matrix. This mirrors the wider Tools V2 decision:
   genuinely separate, not intertwined.

Open question for the SC before writing code here: how to sequence these four (or which
to start with) — this is genuine new SDK-level design, not a continuation of the
leaf-porting pattern from Phase 2.

## Phase 4 — Migrate the `Git_*` tools onto the Leaf shape — NOT STARTED

On `feature/git-tool`, ~40 tools currently one-shot via `createGitTool`. Need wiring as
real leaves so `Git_Fetch && Git_Rebase && Git_Push` actually composes.

## Phase 5 — Retire `Pipe`/`ExecV3` from the catalogue — NOT STARTED

Only once Orchestrate genuinely covers everything those tools do.

## Phase 6 — Split `ReadFile`/`ReadBinaryFile` — NOT STARTED, independent

V1's `ReadFile.ts` currently conflates text and binary via `mimeType`. Split into a
text-only `ReadFile` (batchable, pipeable) and a separate, always-single-target
`ReadBinaryFile` (never fed by a pipe — piping N discovered files into a binary reader
means N PDFs/images actually decoded into context, expensive and irreversible). No
dependency on Phases 3–5; can land any time.

## Explicitly out of scope for this plan

- Env scrubbing at spawn time, and `context`-as-escalation-mechanism — separate
  concerns, not sequenced here, not a prerequisite for anything above.
- The GitHub/AzureDevOps `number`-required-argument fix — a different, unrelated task
  (the SC ruled this out explicitly when it came up mid-design).
