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

Three of the four touch points are now DONE, real code + tests:

1. **Wire tools list** — DONE. Real merge point turned out to be `DurableConfig.toolsV2?:
   BetaTool[]` (new field, `packages/claude-sdk/src/public/types.ts`), threaded through
   `RequestBuilder`/`TurnRunner` alongside `serverTools`, populated by
   `apps/claude-sdk-cli/src/setup/ToolsV2Service.ts` (`toolsV2WireTools(registry)`) and
   consumed in `DurableConfigFactory.#build()`. NOT `IToolRegistry.wireTools` (unused by the
   real request path) and NOT folded into V1's `AnyToolDefinition[]`/`ToolRegistry` —
   genuinely separate arrays merged only at the wire-params level.
2. **Dispatch** — DONE. `packages/claude-sdk/src/public/interfaces.ts` gained
   `IOrchestrateEngine` (`owns(name)`, `run(name, input, requestApproval?)`), injected into
   `QueryRunner` and consulted before the V1 registry in `#runTools` — a V2 name never
   reaches `IToolRegistry.resolve`. Concrete impl: `OrchestrateEngine` in
   `claude-sdk-tools/src/Orchestrate/OrchestrateEngine.ts`, backed by `ToolsV2Registry` +
   `runToolV2Call` (handles both `Orchestrate` composed calls and a direct single-tool call,
   e.g. calling `Find` on its own — both reduce to the same `execute()` call). Registered in
   `apps/claude-sdk-cli/src/setup/container.ts`.
4. **Approval/permissions** — DONE (settled earlier, now wired). V2 never touches V1's
   permission matrix (`apps/claude-sdk-cli/src/permissions.ts`). `QueryRunner`'s
   `#runOrchestrateTool` builds a `requestApproval` callback that reuses
   `ApprovalCoordinator`'s existing keyed request/response plumbing and the
   `tool_approval_request`/`response` wire messages — reused mechanism, not reused policy:
   fires once per gated STAGE (`${toolUseId}:${stageIndex}`), showing that stage's own
   resolved input, honouring only `requireToolApproval` (off → auto-approve everything).

Still open:

3. **Tool rendering** — NOT DONE. The TUI has no shape yet for a multi-stage V2 result
   (`ExecuteResult`/`StageReport[]`) distinct from a V1 single result. Right now a V2 call's
   `tool_result` is just the flattened text `runToolV2Call.summarise()` produces — functional,
   not yet rendered richly.

Known gap, not yet addressed: V2 tool calls run independently of the V1 tool-scoped
`AbortController`/cancel routing in `QueryRunner.#runTools` — ESC-cancel does not currently
interrupt a running Orchestrate call. Flagged in `#runTools`'s own comment; real debt, not
an oversight to silently fix later without deciding how V2 cancellation should work.

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
