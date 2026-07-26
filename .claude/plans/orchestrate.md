# Orchestrate — Plan

Execution checklist. Reasoning and decisions live in `.claude/orchestrate-design.md` —
this file is only the phases and their status, so a new session can resume without
re-deriving the plan from chat history.

Tools V2: Orchestrate is a genuinely separate registration/approval system from the
existing `packages/claude-sdk` `ToolRegistry`/`ApprovalCoordinator`, not a tool bolted
onto it. See the design doc's "This is Tools V2" section for why. Every tool eventually
becomes a ToolV2 — V2 replaces V1 entirely, catalogue-wide. A tool not yet ported (Memory,
History, TypeScript, AzCli, GitHub, AzureDevOps, and everything else besides the handful
built so far) is simply not done yet, not excluded from this plan — priority, not scope.

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

3. **Tool rendering** — NOT DONE. The TUI has no shape yet for a multi-stage V2 result
   (`ExecuteResult`/`StageReport[]`) distinct from a V1 single result. Right now a V2 call's
   `tool_result` is just the flattened text `runToolV2Call.summarise()` produces — functional,
   not yet rendered richly. **Real priority (SC), needs design thought before starting** —
   not a quick follow-on to anything already built.
5. **Approval rendering** — DONE (this session, after the plan text above was written).
   `QueryRunner`'s wire message now sends the gated stage's own resolved `input` (e.g.
   `Program`'s real `program`/`args`), not just the piped batch (which was `[]` for any
   producer stage — that was the actual bug behind "I don't see any input"). Confirmed live:
   a real approval prompt now shows the real command about to run.

**Real priority (SC): fix ESC-cancel.** V2 tool calls run independently of the V1
tool-scoped `AbortController`/cancel routing in `QueryRunner.#runTools` — ESC-cancel does
not currently interrupt a running Orchestrate call. Flagged in `#runTools`'s own comment;
not yet fixed.

## Policy — the unified V1+V2 approval ACL, built and live (separate from the four
## touch points above, but part of this same thread)

Replaces `permissions`/`tools.rules`/`tools.blockedCommands` with one ordered rule list
(`packages/claude-sdk-tools/src/Policy/`) — ACL-shaped (tower/mvp's `bridge::permissions`
is the model), not the old fixed inside/outside grid. `disabledTools` stays separate on
purpose — it's a registration-time decision (does the model see this tool at all), not an
approval-time one, so it was never in scope for this merge.

Done: `matchTool`/`matchInput`/`matchValue`/`matchPath`/`resolve`/`resolveSet`, each
concern tested in isolation plus one composed-policy integration test proving genuine
parity with every real `Exec/ruleConfig.ts` `defaultRules` entry. `validatePolicy` (three
cases: wrong shape → invalid; a rule scoped to a currently-loaded tool referencing a field
it doesn't have → invalid; a rule scoped to a tool that isn't loaded yet → warning only,
not invalid) and `PolicyStore` (never updates to an invalid policy, never has no policy at
all — falls back to a safe ask-everything default). Wired into real V2 approval
(`createPolicyGatedApproval`, consulted by `OrchestrateEngine` before any human-ask).
`policy` is a real, live, top-level (not `tools.policy`) config field with its own
independent watch/notice (`ConfigPolicyProvider`, mirroring `tools.rules`'s own
independent-watch pattern exactly) — `⚠️ policy is invalid` / `✅ policy valid again` /
`🛡️ policy updated`, spliced into the primary view, confirmed live (editing `policy` while
the CLI is running takes effect immediately, no restart).

V2 tool schemas now carry `isPath` markers (`Find.path`, `Paths.paths`, `Program.cwd`,
`Delete.files`) so `collectPaths` can extract real paths for path-scoped rules
(`$PWD`/`*`) to match against — without this, every path-scoped rule was silently
unreachable (`paths` was always `[]`). Two real resolver bugs found and fixed live during
testing, both now covered by tests: (1) `path: '*'` was being skipped when `paths` was
empty, defeating the one rule meant to catch everything, since a wildcard imposes no real
constraint and should match regardless — same principle `tool: '*'` already had right.
(2) A rule that matched but was silent on the specific operation being asked about (no
`operations` entry for it, no `default`) was resolving to `ask` right there instead of
falling through to the next matching rule — meaning an earlier, narrower rule (e.g. a path
zone that only ever talks about read/write) could silently block a later, more general
rule from ever being consulted for an operation the earlier rule never mentioned.

Built the unified V2 `Delete` tool (files and directories in one, no `kind` branch — same
principle as `Match` losing its own) specifically to have something with a real
`fs.delete`-tier `isPath`-marked field to test the above against.

**Not a concern in itself (SC), but the real fix is porting more tools to V2, not a Policy
change:** V1 tools do not go through Policy at all yet (confirmed live — `ReadMemory`
bypasses it entirely). The fix isn't special-casing V1 inside Policy — it's moving more of
the catalogue onto ToolV2, same as `Find`/`Program`/`Delete` already are. This is the real
next body of work: Memory, History, TypeScript, AzCli, GitHub, AzureDevOps, one at a time.

**Not a concern for now (SC):** `ExecV3`/`CreateFile`/`EditFile`/`AppendFile` having no V2
equivalent yet — manage via `disabledTools` in the interim rather than rushing a port.

## Phase 5 — Retire `Pipe`/`ExecV3` from the catalogue — PARTIALLY DONE

`Paths` (the one Pipe tool Orchestrate didn't yet have — the other source alongside `Find`)
built as `createPathsToolV2` (`fs.list` tier, same fatal-on-first-missing-path behaviour as
V1). With that, Orchestrate now covers all seven Pipe tools (Find, Paths, Read, Match, Head,
Tail, Range). `Pipe` retired from `createAppTools.ts` — no longer registered, so V1's
standalone `Find`/`Paths` (which collided by name with V2's) are gone too.

`ExecV3` NOT yet retired — still registered alongside V2's `Program`. That's a separate call
(different tool, not blocked by anything above).

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
