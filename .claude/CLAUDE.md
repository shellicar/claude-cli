<!-- BEGIN:REPO:title -->
# @shellicar/claude-cli — Repo Memory
<!-- END:REPO:title -->

<!-- BEGIN:TEMPLATE:multi-session-pattern -->
## Why This Harness Exists

Each session starts with a blank slate. You have no memory of previous sessions, no recollection of what was built, what broke, what decisions were made. This is the fundamental challenge: complex work spans many sessions, but each session begins from zero.

Without structure, two failure patterns emerge. First, trying to do too much at once, attempting to implement everything in a single pass, running out of context mid-implementation, and leaving the next session with half-built, undocumented work to untangle. Second, looking around at existing progress and prematurely concluding the work is done.

The harness and session logs exist to solve this. They are your memory across sessions: the mechanism that turns disconnected sessions into continuous progress.

**How the pattern works:**

- **On start**: Read the harness and recent session logs to understand current state, architecture, conventions, and what was last worked on. This is how you "get up to speed", the same way an engineer reads handoff notes at the start of a shift.
- **During work**: Work on one thing at a time. Finish it, verify it works, commit it in a clean state. A clean state means code that another session could pick up without first having to untangle a mess. Descriptive commit messages and progress notes create recovery points. If something goes wrong, there is a known-good state to return to.
- **On finish**: Record what you did, what state things are in, and what comes next. This is the handoff note for the next session. Without it, the next session wastes time re-discovering context instead of making progress.

**Why incremental progress matters**: Working on one feature at a time and verifying it before moving on prevents the cascading failures that come from broad, shallow implementation. It also means each commit represents a working state of the codebase.

**Why verification matters**: Code changes that look correct may not work end-to-end. Verify that a feature actually works as a user would experience it before considering it complete. Bugs caught during implementation are cheap; bugs discovered sessions later (when context is lost) are expensive.

The harness is deliberately structured. The architecture section, conventions, and current state are not documentation for its own sake. They are the minimum context needed to do useful work without re-exploring the entire codebase each session.
<!-- END:TEMPLATE:multi-session-pattern -->

<!-- BEGIN:TEMPLATE:never-guess -->
## Never Guess

If you do not have enough information to do something, stop and ask. Do not guess. Do not infer. Do not fill in blanks with what seems reasonable.

This applies to everything: requirements, API behavior, architectural decisions, file locations, conventions, git state, file contents, whether a change is related to your work. If you are not certain, you do not know. Act accordingly.

**Guessing includes not looking.** If you have not checked git status, you do not know what files have changed. If you have not read a file, you do not know what it contains. If you have not verified a build or test output, you do not know whether your changes work. Assuming something is true without checking is a guess. Dismissing something as unrelated without reading it is a guess. Every tool you have exists so you do not need to guess. Use them.

Guessing is poison. A guessed assumption becomes a code decision. Other code builds on that decision. Future sessions read that code and treat it as intentional. By the time the error surfaces, it has compounded across commits, sessions, and hours of wasted time. The damage is never contained to the guess itself: it spreads to everything downstream.

A question costs one message. A look costs one tool call. A guess costs everything built on top of it.
<!-- END:TEMPLATE:never-guess -->

<!-- BEGIN:TEMPLATE:session-protocol -->
## Session Protocol

Every session has three phases: start, work, end.

### Session Start

1. Read this file
2. Find recent session logs: `find .claude/sessions -name '*.md' 2>/dev/null | sort -r | head -5`
3. Read session logs found. Understand current state before doing anything.
4. Create or switch to the correct branch (if specified in prompt)
5. Build your TODO list from the prompt, present it before starting work

### Work

- Work one task at a time. Mark each in-progress, then completed.
- If a task is dropped, mark it `[-]` with a brief reason

### Session End

1. Write a session log to `.claude/sessions/YYYY-MM-DD.md` covering what was done, what changed, decisions made, and what's next. Auto-memory is for transient context about the user. Session logs are for things the project needs to remember: they are version-controlled and visible to every future session.
2. Update `Current State` below if branch or in-progress work changed
3. Update `Recent Decisions` below if you made an architectural decision
4. Commit session log and state updates together
<!-- END:TEMPLATE:session-protocol -->

<!-- BEGIN:REPO:current-state -->
## Current State
Branch: `fix/packaging` — PR #230 open, auto-merge enabled.

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

**PR #230 in review:** Switch packages from custom `build.ts` scripts to tsup. ESM + CJS + DTS per package, correct exports maps, sourcemaps working (fixes debugger breakpoints).

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

### Key files in `apps/claude-sdk-cli/src/`

| File | Role |
|------|------|
| `entry/main.ts` | Entry point: creates agent, layout, starts readline loop |
| `AppLayout.ts` | TUI: full cursor editor, streaming display, compaction blocks, tool approval, command mode, attachment chips |
| `AttachmentStore.ts` | `TextAttachment \| FileAttachment` union; SHA-256 dedup; 10 KB text cap; `addFile(path, kind, size?)` |
| `clipboard.ts` | `readClipboardText()`; three-stage `readClipboardPath()` (pbpaste → VS Code code/file-list JXA → osascript furl); `looksLikePath`; `sanitiseFurlResult` |
| `runAgent.ts` | Wires agent to layout: sets up tools, beta flags, event handlers |
| File | Role |
|------|------|
| `entry/main.ts` | Entry point: creates agent, layout, starts readline loop |
| `AppLayout.ts` | TUI: full cursor editor, streaming display, compaction blocks, tool approval, command mode, attachment chips |
| `AttachmentStore.ts` | `TextAttachment \| FileAttachment` union; SHA-256 dedup; 10 KB text cap; `addFile(path, kind, size?)` |
| `clipboard.ts` | `readClipboardText()`; three-stage `readClipboardPath()` (pbpaste → VS Code code/file-list JXA → osascript furl); `looksLikePath`; `sanitiseFurlResult` |
| `EditorState.ts` | Pure editor state + `handleKey(key): boolean` transitions. No rendering, no I/O. |
| `renderEditor.ts` | Pure `renderEditor(state: EditorState, cols: number): string[]` renderer. |
| `StatusState.ts` | Token/cost accumulators: 7 fields, single `update(msg)` method. Pure state. |
| `renderStatus.ts` | Pure `renderStatus(state: StatusState, cols: number): string` renderer. |
| `AgentMessageHandler.ts` | Maps all `SdkMessage` events → layout calls / state mutations. Extracted from `runAgent.ts`. |
| `runAgent.ts` | Wires agent to layout: sets up tools, beta flags, constructs handler, wires `port.on` |
| `permissions.ts` | Tool auto-approve/deny rules |
| `redact.ts` | Strips sensitive values from tool inputs before display |
| `logger.ts` | Winston file logger (`claude-sdk-cli.log`) |
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
- **No abstract classes as DI tokens** in this codebase — components are concrete classes wired in `ClaudeCli`
- **No TUI framework** — raw ANSI escape sequences on `process.stdout` only
- **JSONL** for audit log — one `{ timestamp, ...SDKMessage }` per line, all types except `stream_event`
- Build output: `dist/` via esbuild
<!-- END:REPO:conventions -->

<!-- BEGIN:REPO:linting-formatting -->
## Linting & Formatting

- **Formatter/linter**: `biome`
- **Git hooks**: `lefthook` — runs biome on commit
- **Fix command**: `pnpm biome check --diagnostic-level=error --write`
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
- **MVVM architecture refactor** (2026-04-06): Three-layer model — State (pure data + transitions), Renderer (pure `(state, cols) → string[]`), ScreenCoordinator (owns screen, routes events, calls renderers). Pull-based: coordinator decides when to render. Plan in `.claude/plans/architecture-refactor.md`. Enables unit testing of state and render logic without terminal knowledge.
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
