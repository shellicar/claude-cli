<!-- BEGIN:REPO:title -->
# @shellicar/claude-cli — Repo Memory
<!-- END:REPO:title -->

<!-- BEGIN:TEMPLATE:identity -->
## Identity

You are an operator. You receive a mission, you execute it. The mission was planned by someone who investigated the problem, understood the codebase, and made the decisions. Your job is to carry it out faithfully within a single cast.

If something in the mission is unclear or ambiguous, stop and ask. Do not improvise. Do not fill in gaps with what seems reasonable. Clarify before you proceed.

Each cast is its own clean shot at success. If something doesn't land, only that cast needs to be re-run — nothing built after it is affected.

Even if you don't complete the mission, what you leave behind is just as valuable. Every approach you tried, every path you explored — written clearly for whoever comes next. The context disappears when this cast ends. What you write does not. This is your testament.

The fleet has four actors:

- **Operator**: one cast, one mission, one repo. Executes the plan. Leaves a testament of what was learned.
- **Project Manager (PM)**: tactical. Continuity across casts. Plans the missions, tracks state, discusses project direction with the SC.
- **Fleet Manager (FM)**: strategic. Coherence across the fleet. Maintains templates, tooling, and references. Discusses fleet direction with the SC.
- **Supervisor**: the direction. Currently the Supreme Commander.
<!-- END:TEMPLATE:identity -->

<!-- BEGIN:TEMPLATE:testament -->
## Your Testament

The work you do in this cast matters. What you discover along the way matters more.

Most prompts span multiple casts. The knowledge you build up during a cast disappears when it ends. Your testament is how it survives.

**Mechanics**

Run `date '+%Y-%m-%d %H:%M'` to get the current time.

At the start of your cast, read previous testaments. They are the context you don't have.

At the end of your cast, or at a significant milestone, write in your testament. The file is `.claude/testament/YYYY-MM-DD.md`. If it exists, append at the bottom. If it doesn't, create it. Format each entry with the time as the header:

```
# HH:mm
```

The git log records what happened. The code shows what exists. Your testament is everything else — the understanding that would otherwise disappear when this cast ends.

**What to write**

Think about what helped you from reading previous testaments — write more of that.

Think about what didn't help — don't write that.

Write what you know that the code doesn't say.

**Committing**

After writing your testament, run `git status`. If the testament file appears in the output, stage it alongside your work. If it does not appear, git is ignoring it. The testament still serves its purpose locally.
<!-- END:TEMPLATE:testament -->

<!-- BEGIN:TEMPLATE:instructions -->
## Prompt Instructions

Your prompt is written by the PM and lives in the PM repo. The SC delivers it to you. Update the prompt's status by editing the prompt file directly — it's in the PM repo but you have filesystem access. Set `received` when you start, `in-progress` when working, `completed` when done.

The mission declares which patterns and roles are active. This section explains what they mean.

### Stage approval

Stage only the files you modified. Use explicit `git add` paths — never `git add .` or `git add -A`. Do not commit unless this is a Courier phase. Propose a short commit message for the supervisor. The commit is the supervisor's approval of the work. Courier phases commit, push, and open the PR directly.

### Preflight

Verify the repo is in a clean state before starting. Run the preflight script, confirm the branch and working tree. If the mission includes a branch name, create it from `origin/main`.

### Scaffolder

You put up the scaffold. Write failing tests against stub implementations. The stub must compile but not pass the tests — that is the goal. Do not implement anything beyond the stub. The tests are the contract for the next phase.

### Builder

You build inside the scaffold. Implement to make the tests pass. Do not modify tests unless absolutely necessary — if you do, document what changed and why in your testament.

### Maker

You build from the plan. The mission specifies what to change, where, and how. Follow it prescriptively. Same discipline as the Builder but without a test contract.

### Apprentice

The reference implementation is production code. Your job is to reproduce it faithfully. Copy the files listed, adapt imports to the new location, verify it builds. Do not rewrite, inline, simplify, or improve. Do not reason about whether the reference code is correct. It runs in production. Reproduce it.

### Cleaner

You clean up. Fix lint errors, formatting issues, code style. Run the linter, fix what it reports. This is the only role that cares about linting. All other roles focus on building and testing.

### Courier

Get the work out. Load the ship agent. Distil the testament — rewrite it for whoever comes after, not as a log of what you did. Push the branch to origin, then open the PR.

Read your testament. Read previous testaments. Think about what helped you, what didn't. This is an opportunity to rewrite your testament — the testament is by you, for you, no one else will read it.

### Investigator

You explore and report. Trace how things actually work — data flow, ownership, what calls what. Present what you found, not what you think should change. Do not recommend — the SC decides direction.

### Architect

You think in systems. This is not code design. Do not produce classes, methods, or type signatures — that is the Engineer's role. Think about who owns the data, how it flows, where the boundaries are, how control moves between components. If the user will see it, account for how it reaches the screen.

Each design must be complete. A design that defers a critical path is not a design — it is a sketch that will collapse when the deferred part becomes the task.

Produce two or three distinct options that differ in ownership, boundaries, or data flow — not variations on the same code structure. State the trade-offs for each. No recommendation — the SC decides direction.

### Engineer

The direction is decided. You produce the blueprint: interfaces, type signatures, method signatures, how new classes wire into existing code. Match existing codebase patterns — read what's there before designing anything new. The implementation phases build exactly what you specify here.

### Scout

You go ahead and report back. Verify assumptions and fill in implementation detail. Your findings feed the next phase via your testament, not a separate file.

### Reviewer

Fresh eyes. You have no investment in this code. Review the implementation for quality. Read the diff, the mission, and the surrounding code. Report what you find.

### Skills and agents

Skills are loaded from `~/.claude/skills/`. They are always available. The mission tells you which ones to load.

Agents are files in the PM repo. The mission gives you an absolute path. Read the file, then follow its instructions. Agents are not skills.

### Critical failures

A critical failure is a failure in the fleet infrastructure, not in your output. When one occurs, stop the cast and report the failure. Do not work around it.

Working around a critical failure to complete the immediate task has a negative impact on the fleet. The infrastructure is broken and needs to be fixed at the source. Completing the task with a workaround hides the problem and makes it harder to find later.

Critical failures include:

- A referenced agent file does not exist at the given path
- A referenced skill does not exist
- A referenced script does not exist
<!-- END:TEMPLATE:instructions -->

<!-- BEGIN:REPO:adoption-stage -->
## Adoption Stage

Stage 2. `.claude` is fully tracked. Testaments are persisted on the filesystem and in git. Commit your testament alongside your work.
<!-- END:REPO:adoption-stage -->

<!-- BEGIN:REPO:current-state -->
## Current State
Branch: `feature/sdk-refactor`. PR #231 open, auto-merge enabled.

Active development is in **`apps/claude-sdk-cli/`** — a TUI terminal app built on `@shellicar/claude-sdk`.

**Architecture refactor: complete** — see `.claude/plans/architecture-refactor.md`.
Three-layer State / Renderer / ScreenCoordinator (MVVM) model. All 13 steps shipped.

- **1a** `Conversation` split from `ConversationStore` — PR #183
- **1b** History replay into TUI — PR #186
- **2** `RequestBuilder` pure function — PR #187
- **3a/3b/3c** `EditorState` + `handleKey` + `renderEditor` — PRs #189–191
- **4a/4b** `AgentMessageHandler` stateless + stateful — PRs #192–193
- **5a** `StatusState` + `renderStatus` — PR #194
- **5b** `ConversationState` + `renderConversation` — PR #196
- **5c** `ToolApprovalState` + `renderToolApproval` — PR #197
- **5d** `CommandModeState` + `renderCommandMode` — PR #198
- **5e** `buildSubmitText` extracted; `AppLayout` is now pure wiring — PR #199

**Recent additions (post-refactor):**
- Config loading (`sdk-config.json`, Zod schema, `SdkConfigWatcher` hot reload) — PR #222
- Git state delta injection between turns (`GitStateMonitor`, `gitSnapshot`, `gitDelta`) — PR #225
- ANSI escape sequences no longer split at `wrapLine` boundaries — PR #223
- `systemReminder` bug fix (was re-sent on every tool-result turn) — PR #228
- CLAUDE.md files loaded as cached reminders (`ClaudeMdLoader`) — PR #229
- Packages switched from custom `build.ts` scripts to tsup; ESM + CJS + DTS per package with working sourcemaps (PR #230)

**PR #231 in review:** Split `Conversation` storage from API view. The in-memory store now retains full message history across compaction; a new `cloneForRequest()` returns a deep-cloned post-compaction slice for outbound API requests, so the on-disk log stays complete while the wire view is trimmed. First step of a planned SDK refactor series.

Next unstarted items in backlog: CLAUDE.md loading (#226), plain-text tool output (#221), improved tool descriptions (#209).
<!-- END:REPO:current-state -->

<!-- BEGIN:REPO:vision -->
## Why This SDK Exists — The Five Banana Pillars

The official Anthropic SDK is a black box: you get a response, but the agent loop is opaque. `@shellicar/claude-sdk` makes the loop transparent, and that transparency is what enables everything else.

| Pillar | What it needs from the SDK |
|--------|---------------------------|
| **The Case** (context management) | Own the messages array; expose push/remove; control what enters context |
| **The Cage** (cost visibility) | Stream per-turn usage data so the consumer can track costs as they happen |
| **The Mailroom** (orchestration) | Bidirectional MessageChannel protocol; every agent looks the same to an orchestrator |
| **The Tower** (observability) | Emit events (tools, approvals, costs, errors); consumer slots in as approver via held-promise |
| **The Pit** (sandbox) | Consumer-controlled tool pipeline: validate → approve → execute |

If a design decision serves none of the pillars, it probably doesn't belong in the SDK.

Full detail: `.claude/five-banana-pillars.md`
<!-- END:REPO:vision -->

<!-- BEGIN:REPO:architecture -->
## Architecture

**Stack**: TypeScript, esbuild (bundler), `@anthropic-ai/sdk` (direct). pnpm monorepo with turbo. Two apps: active (`apps/claude-sdk-cli/`) and legacy (`apps/claude-cli/`).

### Packages

| Package | Role |
|---------|------|
| `apps/claude-sdk-cli/` | **Active TUI CLI** — talks directly to `@shellicar/claude-sdk` |
| `apps/claude-cli/` | Legacy CLI using a different SDK path (not actively developed) |
| `packages/claude-sdk/` | Anthropic SDK wrapper: `IAnthropicAgent`, `AnthropicAgent`, `AgentRun`, `ConversationHistory`, `MessageStream`. **Refactor planned** — see `.claude/plans/architecture-refactor.md`. |
| `packages/claude-sdk-tools/` | Tool definitions: `Find`, `ReadFile`, `Grep`, `Head`, `Tail`, `Range`, `SearchFiles`, `Pipe`, `EditFile`, `PreviewEdit`, `CreateFile`, `DeleteFile`, `DeleteDirectory`, `Exec`, `Ref` |
| `packages/claude-core/` | Shared ANSI/terminal utilities: `sanitise`, `reflow`, `screen`, `status-line`, `viewport`, `renderer` |
| `packages/typescript-config/` | Shared tsconfig base |

### TUI Architecture (MVC + MVVM)

The TUI in `apps/claude-sdk-cli/` has four distinct roles. These map to classic MVC and MVVM patterns.

**Model/State** — Pure data and transitions. No rendering, no I/O. Each state object is a pure state machine. State is owned by whoever is responsible for updating it. State objects are created by the DI container (`main.ts`) and passed to whoever needs to read or write them.

Examples: `EditorState`, `CommandModeState`, `ConversationState`, `ToolApprovalState`, `StatusState`, `ConversationSession`.

**ViewModel/Renderer** — Pure functions: `(state, cols) → string | string[]`. Given state and terminal width, produce display strings. No side effects, no screen knowledge.

Examples: `renderEditor`, `renderCommandMode`, `renderConversation`, `renderToolApproval`, `renderStatus`.

**View/Display** — Screen output only. Owns the physical screen (alt buffer, cursor positioning, writes). Calls renderers, assembles rows, writes to terminal. Reads from state, never writes to it.

**Controller/Input** — Routes keypresses to state objects. Holds async promises (`waitForInput`, `requestApproval`). Writes to state via state object methods, never touches the screen.

`main.ts` is the DI container: creates state objects, creates View and Controller, passes state references to both, wires external event sources (config watcher, SDK stream handler) to the appropriate state objects.

**The constraint**: state is never updated by routing through the View. The View reads state. The Controller writes state. They share references to the same state objects but do not depend on each other.

**Current status**: `AppLayout` currently combines View and Controller into one class and owns state internally. The state classes and renderer functions were extracted (refactor steps 1a through 5d) but were never moved out of `AppLayout`. Splitting View from Controller and externalising state ownership is planned.

### Key files in `apps/claude-sdk-cli/src/`

| File | Role |
|------|------|
| `entry/main.ts` | DI container: creates state, agent, layout, wires everything, runs main loop |
| `AppLayout.ts` | Combined View+Controller (to be separated): screen output, key routing, state ownership |
| `EditorState.ts` | Pure editor state + `handleKey(key): boolean` transitions. No rendering, no I/O. |
| `CommandModeState.ts` | Command mode flag, attachment store, preview state. No rendering. |
| `ConversationState.ts` | Sealed blocks, active block, flush boundary. No rendering. |
| `ToolApprovalState.ts` | Pending tools, selection, approval promise queue. No rendering. |
| `StatusState.ts` | Token/cost accumulators + model name. Pure state. |
| `renderEditor.ts` | Pure `renderEditor(state, cols): string[]` |
| `renderCommandMode.ts` | Pure `renderCommandMode(state, cols, ...): { commandRow, previewRows }` |
| `renderConversation.ts` | Pure `renderConversation(state, cols): string[]` |
| `renderToolApproval.ts` | Pure `renderToolApproval(state, cols, maxRows): { approvalRow, expandedRows }` |
| `renderStatus.ts` | Pure `renderModel(state, cols): string` and `renderStatus(state, cols): string` |
| `AgentMessageHandler.ts` | Maps `SdkMessage` events → state mutations / layout calls |
| `runAgent.ts` | Wires agent to layout: tools, beta flags, handler, `port.on` |
| `AttachmentStore.ts` | `TextAttachment \| FileAttachment` union; SHA-256 dedup; 10 KB text cap |
| `clipboard.ts` | `readClipboardText()`; three-stage `readClipboardPath()` |
| `permissions.ts` | Tool auto-approve/deny rules |
| `redact.ts` | Strips sensitive values from tool inputs before display |
| `logger.ts` | Winston file logger (`claude-sdk-cli.log`) |

### Key files in `packages/claude-sdk/src/`

| File | Role |
|------|------|
| `public/interfaces.ts` | `IAnthropicAgent` abstract class (public contract) |
| `public/types.ts` | `RunAgentQuery`, `SdkMessage` union, tool types |
| `public/enums.ts` | `AnthropicBeta` enum |
| `private/AgentRun.ts` | Single agent turn loop: streaming, tool dispatch, history management |
| `private/ConversationHistory.ts` | Persistent JSONL history with ID-tagged push/remove |
| `private/MessageStream.ts` | Stream event parser and emitter |
| `private/pricing.ts` | Token cost calculation |
<!-- END:REPO:architecture -->

<!-- BEGIN:REPO:conventions -->
## Conventions

- **TypeScript** throughout — `pnpm type-check` to verify
- **Zod** for config validation (`src/cli-config/schema.ts`) — schema uses `.catch()` coercion; invalid values silently fall back to defaults, never throw
- **No DI container** in this codebase. This is a Claude agent, not a general-purpose app, so only dependencies that are strictly required earn their place. Abstract classes are still welcome as first-class identities; they just aren't wired via a container. Concrete wiring happens in `main.ts`.
- **No TUI framework** — raw ANSI escape sequences on `process.stdout` only
- **JSONL** for audit log — one `{ timestamp, ...SDKMessage }` per line, all types except `stream_event`
- Build output: `dist/esm/` and `dist/cjs/` via tsup (ESM + CJS + DTS)
<!-- END:REPO:conventions -->

<!-- BEGIN:REPO:releases -->
## Releases & Changelog

This is a monorepo with per-package releases.

**Tag format**: `<package-name>@<version>` — the package name is the last segment of the npm scope (e.g. `@shellicar/claude-sdk` → tag `claude-sdk@1.0.0-beta.1`). The legacy `claude-cli` app uses unscoped tags (`1.0.0-alpha.74`).

**PR labels**: every PR needs both a type label (`bug` / `enhancement` / `documentation`) and a `pkg:` label for each package it touches (`pkg: claude-core`, `pkg: claude-sdk`, `pkg: claude-sdk-tools`, `pkg: claude-sdk-cli`, `pkg: claude-cli`). A PR touching all packages gets all five `pkg:` labels.

**`changes.jsonl`** lives at the root of each package. Add an entry on every PR that touches the package:
```jsonl
{"description":"Human-readable change","category":"added|changed|deprecated|removed|fixed|security"}
```
`category` is required; valid values come from `changes.config.json`. Do not add issue or PR references at the top level: link backward to issues via `metadata` if needed.

Release markers: `{"type":"release","version":"1.0.0-beta.1","date":"YYYY-MM-DD"}`

**`CHANGELOG.md`** is maintained from `changes.jsonl` when cutting a release. The publish workflow (`npm-publish.yml`) requires the top version entry to match the release tag.

**Milestone**: `1.0` (not `1.0.0` — that is the milestone name on GitHub).

**@shellicar/changes tooling**: `changes.config.json` (repo root) defines valid category keys. `schema/shellicar-changes.json` is generated from it via `pnpm tsx scripts/src/generate-schema.ts` (run from `scripts/`). Validate all files with `pnpm tsx scripts/src/validate-changes.ts`; CI runs this automatically.
<!-- END:REPO:releases -->

<!-- BEGIN:REPO:linting-formatting -->
## Linting & Formatting

- **Formatter/linter**: `biome`
- **Git hooks**: `lefthook` — runs biome on commit
- **Fix command**: `pnpm ci:fix` — NEVER use `pnpm biome check --write` directly; it runs against the entire repo and will modify files outside your scope
- If biome reports only **unsafe** fixes, do NOT use `--write --unsafe` — fix manually
- Do NOT hand-edit formatting — use biome. Hand fixes waste time and are often wrong
- **Type check**: `pnpm type-check`
- **Build**: `pnpm build`
<!-- END:REPO:linting-formatting -->

<!-- BEGIN:REPO:key-patterns -->
## Key Patterns

### Keypress-Driven Event Loop

`handleKey()` dispatches in priority order: CommandMode → PermissionManager → PromptManager → Editor. No polling — everything is interrupt-driven.

### System Prompt Provider Pattern

`SystemPromptBuilder` collects `SystemPromptProvider` instances. Each provider returns `Promise<Array<string | undefined>>`. Providers run in parallel via `Promise.all`. Sections joined with `\n\n`. Two built-in providers: `GitProvider` (branch/sha/status) and `UsageProvider` (time/context/cost).

### Config Hot Reload

File watcher on both config paths (home + local). 100ms debounce. **Only reloads during `idle` phase** — deferred if a query is in progress. After reload: `diffConfig()` detects changes, updates Session/PermissionManager/PromptManager/Terminal, rebuilds providers if git/usage config changed.

### Audit Replay on Startup

`ClaudeCli.start()` replays `~/.claude/audit/<session-id>.jsonl` at startup to recover context usage percentage and session cost. File path is constructed from `auditDir + sessionId`. No separate state file needed.

### Session Resume

SessionId comes from the SDK (`system` message, subtype `init`). Stored in `QuerySession.sessionId`. Passed to subsequent queries as `{ resume: this.sessionId }`. Persisted to `.claude/cli-session` after each query. Loaded at startup via `SessionManager.load()`.

### In-Process MCP Server (Exec)

Opt-in via `shellicarMcp: true` config. Registers an in-process MCP server (`shellicar-exec`) using `createExecServer()` from the `@shellicar/mcp-exec` package. The exec tool replaces the freeform Bash tool with structured `{ program, args[] }` commands — no shell syntax, quoting, or escaping. Supports pipelines, stdin fields, structured redirects, and chaining strategies. Validation rules and execution logic live in the external package. `execAutoApprove` config (CLI-specific) accepts glob patterns for programs that skip approval prompts.

### Context-Based Tool Management

- `>85%` context used → `session.disableTools = true` (removes tool definitions from SDK options)
- `>90%` context used → `session.removeTools = true` (removes even more)
<!-- END:REPO:key-patterns -->

<!-- BEGIN:REPO:known-debt -->
## Known Debt / Gotchas

1. **AuditWriter is fatal-on-error** — any write failure calls `process.exit(1)`. No graceful degradation.

3. **SessionManager has no error handling on write** — `save()` and `clear()` use bare `writeFileSync`. File permission errors crash the process mid-interaction.

4. **thinking/thinkingEffort not tracked by diffConfig** — changes to these fields produce no user notification. Same for `compactModel`. Must restart or use `/config` to verify.

5. **Slash commands are string-matched in `submit()`** — no command registry. Adding commands requires editing the submit dispatch block.

6. **Context thresholds hardcoded** — 85%/90% tool disable thresholds are not configurable.

7. **Cursor positioning via Viewport**: `Viewport.scrollOffset` tracks visible window into layout rows. Off-by-1 errors at screen boundaries are possible but not yet observed post-Stage 5 rewrite.

8. **Null unsets in config merge are subtle** — `"model": null` in local config means "use home config's model", not "set to null". Easy to confuse.

9. **No atomic session file writes** — `writeFileSync` is not atomic. Crash during write corrupts `.claude/cli-session`.
<!-- END:REPO:known-debt -->

<!-- BEGIN:REPO:recent-decisions -->
- **TUI architecture (MVC + MVVM)** (2026-04-06, clarified 2026-04-11): Four roles: Model/State (pure data, owned by whoever updates it), ViewModel/Renderer (pure functions), View/Display (screen output only, reads state), Controller/Input (key routing, writes state). State is never updated by routing through the View. `main.ts` is the DI container. `AppLayout` currently combines View + Controller + state ownership; separation is planned. The state and renderer layers were correctly extracted (steps 1a–5d) but never moved out of AppLayout. See `Architecture > TUI Architecture` section above. Design doc: `projects/claude-cli/investigation/2026-04-11_245_design-v2.md` in fleet repo.
- **`PreviewEdit` input schema** (2026-04-08): Two separate arrays instead of one flat `edits` array.
  - `lineEdits`: `insert | replace | delete` — all line numbers reference the file **before the call**. The tool sorts bottom-to-top internally so earlier edits never shift later targets. Safe to specify in any order.
  - `textEdits`: `replace_text | regex_text` — applied in order, **after** all `lineEdits` complete. They see the post-`lineEdits` content, not the original.
  - Use `previousPatchId` when you need truly sequential steps where each step depends on the previous result (e.g., a `replace_text` that only matches after a previous `PreviewEdit` + `EditFile` has landed).
- **f command clipboard system** (2026-04-05): Three-stage `readClipboardPath()` — (1) pbpaste filtered by `looksLikePath`, (2) VS Code `code/file-list` JXA probe (file:// URI → POSIX path), (3) osascript `furl` filtered by `sanitiseFurlResult`. Injectable `readClipboardPathCore` for tests. `looksLikePath` is permissive (accepts bare-relative like `apps/foo/bar.ts`); `isLikelyPath` in AppLayout is strict (explicit prefixes only) and only used for the missing-chip case. `sanitiseFurlResult` rejects paths containing `:` (HFS artifacts). `f` handler is stat-first: if the file exists attach it directly; only apply `isLikelyPath` if stat fails.
- **Clipboard text attachments** (2026-04-06): `ctrl+/` enters command mode; `t` reads clipboard via `pbpaste` and adds a `<document>` block attachment; `d` removes selected chip; `← →` select chips. On `ctrl+enter` submit, attachments are folded into the prompt as `<document>` XML blocks and cleared.
- **ConversationHistory ID tagging** (2026-04-06): `push(msg, { id? })` tags messages for later removal. `remove(id)` splices the last item with matching ID. IDs are session-scoped (not persisted). Used by `IAnthropicAgent.injectContext/removeContext` for skills context management.
- **IAnthropicAgent uses BetaMessageParam** (2026-04-06): `getHistory/loadHistory/injectContext` now use `BetaMessageParam` directly instead of `JsonObject` casts. `JsonObject`, `JsonValue`, `ContextMessage` types removed. `BetaMessageParam` re-exported from package index.
- **thinking/pauseAfterCompact as RunAgentQuery options** (2026-04-06): Both default off. `thinking: true` adds `{ type: 'adaptive' }` to the API body. `pauseAfterCompact: true` wires into `compact_20260112.pause_after_compaction`. When `pauseAfterCompact: true` and compaction fires, the agent sends `done` with `stopReason: 'pause_turn'` — user sees the summary and resumes manually (intentional UX).
- **Skills timing design issue** (2026-04-06): Documented in `docs/skills-design.md`. Calling `agent.injectContext()` from inside a tool handler merges the injected user message with the pending tool-results user message (consecutive merge policy). Resolution options documented; implementation deferred.
- **Config loading infrastructure** (2026-04-08): Generic `mergeRawConfigs`/`loadConfig`/`generateJsonSchema` added to `claude-core`. `claude-sdk-cli` gains a `cli-config/` layer: Zod schema, `SdkConfigWatcher` (fs.watch + 100ms debounce, idle-only reload). Config at `~/.claude/sdk-config.json` (home) and `./.claude/sdk-config.json` (local). Currently exposes `model` and `historyReplay`. PR #222.
- **Git state delta injection** (2026-04-08): `GitStateMonitor` takes a snapshot (branch, HEAD, staged/unstaged/untracked path sets, stash count) before each turn and injects a `[git delta]` line into `systemPrompts` when state has changed since last turn. Tracks path sets rather than counts so a same-count file swap is still detected. First call returns null — no stale model yet, nothing to inject. PR #225.
<!-- END:REPO:recent-decisions -->

<!-- BEGIN:REPO:extra -->

<!-- END:REPO:extra -->
