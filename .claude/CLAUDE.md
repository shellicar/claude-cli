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

`feature/sdk-tooling` merged to main (`974e1c0`). No active branch. Clean.

`apps/claude-sdk-cli/` is the active TUI app. It serves two purposes:
1. **Development/observation tool** — for working on this codebase interactively
2. **Proof of concept** — demonstrates all five banana pillars working in practice

**Completed (all in `feature/sdk-tooling`):**
- Full cursor-aware multi-line editor
- Clipboard attachments: text (`t`) and file (`f`) via three-stage probe, preview (`p`), delete (`d`)
- `ConversationHistory` ID-tagged push/remove; consecutive user message merge
- `IAnthropicAgent.injectContext/removeContext` public API
- `RunAgentQuery.thinking` + `pauseAfterCompact`; `BetaMessageParam` in public interface
- Ref tool + RefStore + walkAndRef for large output ref-swapping
- Tool approval flow (auto-approve/deny/prompt); redact sensitive values
- Compaction display with context high-water mark
- Vitest suite: 52 tests for clipboard system

**Next:**
- `claude-sandbox` — the Pit; isolated execution environment for fire-and-forget agent jobs (see `sandbox-claude.md` in `claude-fleet`)
- `#177` LSP validation for file edits — POC exists; advisory mode; fits PreviewEdit/EditFile
- `#178` System reminders for file modifications — between-turns mtime tracking in NodeFileSystem
- `#179` Alt/history view — block navigation + search for `claude-sdk-cli`
- `#101`/`#104` Exec permission model — for development machine use
- `#94` Always show model name in status line
<!-- END:REPO:current-state -->
<!-- BEGIN:REPO:architecture -->
## Architecture

**Stack**: TypeScript, esbuild (bundler), `@anthropic-ai/sdk` (direct). pnpm monorepo with turbo. Two apps: active (`apps/claude-sdk-cli/`) and legacy (`apps/claude-cli/`).

### Packages

| Package | Role |
|---------|------|
| `apps/claude-sdk-cli/` | **Active TUI CLI** — talks directly to `@shellicar/claude-sdk` |
| `apps/claude-cli/` | Legacy CLI using a different SDK path (not actively developed) |
| `packages/claude-sdk/` | Anthropic SDK wrapper: `IAnthropicAgent`, `AnthropicAgent`, `AgentRun`, `ConversationHistory`, `MessageStream` |
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
- **f command clipboard system** (2026-04-05): Three-stage `readClipboardPath()` — (1) pbpaste filtered by `looksLikePath`, (2) VS Code `code/file-list` JXA probe (file:// URI → POSIX path), (3) osascript `furl` filtered by `sanitiseFurlResult`. Injectable `readClipboardPathCore` for tests. `looksLikePath` is permissive (accepts bare-relative like `apps/foo/bar.ts`); `isLikelyPath` in AppLayout is strict (explicit prefixes only) and only used for the missing-chip case. `sanitiseFurlResult` rejects paths containing `:` (HFS artifacts). `f` handler is stat-first: if the file exists attach it directly; only apply `isLikelyPath` if stat fails.
- **Clipboard text attachments** (2026-04-06): `ctrl+/` enters command mode; `t` reads clipboard via `pbpaste` and adds a `<document>` block attachment; `d` removes selected chip; `← →` select chips. On `ctrl+enter` submit, attachments are folded into the prompt as `<document>` XML blocks and cleared.
- **ConversationHistory ID tagging** (2026-04-06): `push(msg, { id? })` tags messages for later removal. `remove(id)` splices the last item with matching ID. IDs are session-scoped (not persisted). Used by `IAnthropicAgent.injectContext/removeContext` for skills context management.
- **IAnthropicAgent uses BetaMessageParam** (2026-04-06): `getHistory/loadHistory/injectContext` now use `BetaMessageParam` directly instead of `JsonObject` casts. `JsonObject`, `JsonValue`, `ContextMessage` types removed. `BetaMessageParam` re-exported from package index.
- **thinking/pauseAfterCompact as RunAgentQuery options** (2026-04-06): Both default off. `thinking: true` adds `{ type: 'adaptive' }` to the API body. `pauseAfterCompact: true` wires into `compact_20260112.pause_after_compaction`. When `pauseAfterCompact: true` and compaction fires, the agent sends `done` with `stopReason: 'pause_turn'` — user sees the summary and resumes manually (intentional UX).
- **Skills timing design issue** (2026-04-06): Documented in `docs/skills-design.md`. Calling `agent.injectContext()` from inside a tool handler merges the injected user message with the pending tool-results user message (consecutive merge policy). Resolution options documented; implementation deferred.
## Recent Decisions

- **Structured command execution via in-process MCP** (#99) — replaced freeform Bash with a structured Exec tool served by an in-process MCP server. Glob-based auto-approve (`execAutoApprove`) with custom zero-dep glob matcher (no minimatch dependency).
- **Exec tool extracted to `@shellicar/mcp-exec`** — schema, executor, pipeline, validation rules, and ANSI stripping moved to a published package. CLI retains only `autoApprove.ts` (CLI-specific config concern).
- **ZWJ sanitisation in layout pipeline**: `sanitiseZwj` strips U+200D before `wrapLine` measures width. Terminals render ZWJ sequences as individual emojis; `string-width` assumes composed form. Stripping at the layout boundary removes the mismatch.
- **Monorepo workspace conversion**: CLI source moved to `packages/claude-cli/`. Root package is private workspace with turbo, syncpack, biome, lefthook. Turbo orchestrates build/test/type-check. syncpack enforces version consistency. `.packagename` file at root holds the active package name for scripts and pre-push hooks.
- **SDK bidirectional channel** (`packages/claude-sdk/`): New package wrapping the Anthropic API. Uses `MessagePort` for bidirectional consumer/SDK communication. Tool validation (existence + input schema) happens before approval requests are sent. Approval requests are sent in bulk; tools execute in approval-arrival order.
- **Screen utilities extracted to `claude-core`**: `sanitise`, `reflow` (wrapLine/rewrapFromSegments/computeLineSegments), `screen` (Screen interface + StdoutScreen), `status-line` (StatusLineBuilder), `viewport` (Viewport), `renderer` (Renderer) all moved from `claude-cli` to `claude-core`. `claude-cli` now imports from `@shellicar/claude-core/*`. `tsconfig.json` in claude-core requires `"types": ["node"]` for process globals with moduleResolution bundler.
<!-- END:REPO:recent-decisions -->

<!-- BEGIN:REPO:extra -->
<!-- END:REPO:extra -->
