# @shellicar/claude-cli — Repo Memory

## Session Protocol

**Every session follows this cycle. No exceptions.**

### On Start
1. Read this file
2. Check for previous session logs: `find .claude/sessions -name '*.md' 2>/dev/null | head -5` (SDK tools cannot see gitignored files — use bash for session discovery)
3. Read any session logs found, understand current state before doing anything

### During Work
- Use the TODO list to track all tasks — create it at session start, update as you go
- Work incrementally — one feature/fix at a time
- Mark each TODO in-progress before starting, completed immediately after finishing
- If a TODO is dropped or no longer relevant, mark it `[-]` with a brief reason — **never silently remove a task**
- Commit with descriptive messages after each meaningful change
- **Be proactive** — after completing a step, immediately state what you're doing next and move to it. Do not stop and wait for the user to ask "what's next?" If there are remaining TODOs, start the next one. If you're blocked, say why and suggest how to unblock.

**Every TODO list MUST end with these items. They are not optional.**
**Execute them IN ORDER. Each step blocks the next.**
```
- [ ] Verify changes work (type-check, tests, lint — whatever applies)
- [ ] Ask user to test the feature before marking it done
- [ ] Write session log (`.claude/sessions/YYYY-MM-DD.md`)
- [ ] Update CLAUDE.md current state (if changed)
- [ ] Commit all changes (session log and state updates MUST be in this commit)
```
Do not mark the session complete until all TODOs — including these — are done.

**Why this order matters:** The session log is a tracked file. If you commit first and write the log after, it either gets left out or requires a separate throwaway commit. Write the log, update state, THEN commit — one clean commit that includes everything.

### On Finish (before committing)

Do NOT invoke git-commit until steps 1-3 are done.

1. Write session log to `.claude/sessions/YYYY-MM-DD.md`:
   ```
   ### HH:MM — [area/task]
   - Did: (1-3 bullets)
   - Files: (changed files)
   - Decisions: (what and why — include any tasks dropped and why they were dropped)
   - Next: (what remains / blockers)
   ```
2. Update `Current State` below if the branch or in-progress work changed
3. Update `Recent Decisions` below if you made an architectural decision or discovered a new convention/gotcha
4. NOW commit — session log and state updates are included in the commit

## Current State

Branch: `main`
In-progress: None. Audit centralisation complete and tested.

## Architecture

**Stack**: TypeScript, esbuild (bundler), `@anthropic-ai/claude-agent-sdk`. No monorepo — single package.

**Entry point**: `src/main.ts` — parses CLI flags, creates `ClaudeCli`, calls `start()`

**Key source files**:

| File | Role |
|------|------|
| `src/ClaudeCli.ts` | Orchestrator — startup sequence, event loop, query cycle |
| `src/session.ts` | `QuerySession` — SDK wrapper, session/resume lifecycle |
| `src/AppState.ts` | Phase state machine (`idle → sending → thinking → idle`) |
| `src/terminal.ts` | ANSI terminal rendering, three-zone layout |
| `src/renderer.ts` | Pure editor content preparation (cursor math) |
| `src/StatusLineBuilder.ts` | Fluent builder for width-accurate ANSI status lines |
| `src/SessionManager.ts` | Session file I/O (`.claude/cli-session`) |
| `src/AuditWriter.ts` | JSONL event logger (`~/.claude/audit/<session-id>.jsonl`) |
| `src/files.ts` | `initFiles()` — creates `.claude/` dir, returns `CliPaths` |
| `src/cli-config/` | Config subsystem — schema, loading, diffing, hot reload |
| `src/providers/` | `GitProvider`, `UsageProvider` — system prompt data sources |
| `src/PermissionManager.ts` | Tool approval queue and permission prompt UI |
| `src/PromptManager.ts` | `AskUserQuestion` dialog — single/multi-select + free text |
| `src/CommandMode.ts` | Ctrl+/ state machine for attachment and session operations |
| `src/SdkResult.ts` | Parses `SDKResultSuccess` — extracts errors, rate limits, token counts |
| `src/UsageTracker.ts` | Context usage and session cost tracking interface |
| `docs/sdk-findings.md` | SDK behaviour discoveries (session semantics, tool options, etc.) |

## Conventions

- **TypeScript** throughout — `pnpm type-check` to verify
- **Zod** for config validation (`src/cli-config/schema.ts`) — schema uses `.catch()` coercion; invalid values silently fall back to defaults, never throw
- **No abstract classes as DI tokens** in this codebase — components are concrete classes wired in `ClaudeCli`
- **No TUI framework** — raw ANSI escape sequences on `process.stdout` only
- **JSONL** for audit log — one `{ timestamp, ...SDKMessage }` per line, all types except `stream_event`
- Build output: `dist/` via esbuild

## Linting & Formatting

- **Formatter/linter**: `biome`
- **Git hooks**: `lefthook` — runs biome on commit
- **Fix command**: `pnpm biome check --diagnostic-level=error --write`
- If biome reports only **unsafe** fixes, do NOT use `--write --unsafe` — fix manually
- Do NOT hand-edit formatting — use biome. Hand fixes waste time and are often wrong
- **Type check**: `pnpm type-check`
- **Build**: `pnpm build`

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

### Context-Based Tool Management

- `>85%` context used → `session.disableTools = true` (removes tool definitions from SDK options)
- `>90%` context used → `session.removeTools = true` (removes even more)

## Known Debt / Gotchas

1. **AuditWriter is fatal-on-error** — any write failure calls `process.exit(1)`. No graceful degradation.

3. **SessionManager has no error handling on write** — `save()` and `clear()` use bare `writeFileSync`. File permission errors crash the process mid-interaction.

4. **thinking/thinkingEffort not tracked by diffConfig** — changes to these fields produce no user notification. Same for `compactModel`. Must restart or use `/config` to verify.

5. **Slash commands are string-matched in `submit()`** — no command registry. Adding commands requires editing the submit dispatch block.

6. **Context thresholds hardcoded** — 85%/90% tool disable thresholds are not configurable.

7. **Cursor positioning is fragile** — `stickyLineCount` is a single point of truth and failure. Occasional off-by-1 documented but not reliably reproducible.

8. **Null unsets in config merge are subtle** — `"model": null` in local config means "use home config's model", not "set to null". Easy to confuse.

9. **No atomic session file writes** — `writeFileSync` is not atomic. Crash during write corrupts `.claude/cli-session`.

## Recent Decisions

<!-- Architectural decisions from recent sessions -->
