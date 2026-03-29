<!-- BEGIN:REPO:title -->
# @shellicar/claude-cli — Repo Memory
<!-- END:REPO:title -->

<!-- BEGIN:TEMPLATE:session-protocol -->
## Session Protocol

Every session has three phases. Follow them in order. Session start sets up the workspace, work is the development, session end records what happened. Start and end wrap the work so nothing is lost.

```
- [ ] Session start
- [ ] <your work steps here>
- [ ] Session end
```

### Session Start
1. Read this file
2. Find recent session logs: `find .claude/sessions -name '*.md' 2>/dev/null | sort -r | head -5`
3. Read session logs found. Understand current state before doing anything.
4. Create or switch to the correct branch (if specified in prompt)
5. Build your TODO list using TodoWrite. Include all work steps from the prompt, then append `Session end` as the final item.

### Work
This is where you do the actual development: writing code, fixing bugs, running tests, verifying changes. Each step from the prompt becomes a TODO item.

- Work incrementally, one task at a time
- Mark each TODO in-progress before starting, completed immediately after finishing
- If a TODO is dropped, mark it `[-]` with a brief reason. Never silently remove a task.
- Commit with descriptive messages after each meaningful change
- If your prompt includes WORK ITEMS, reference them in commit messages (e.g. `#82`, `AB#1234`)
- Be proactive: after completing a step, start the next one. If blocked, say why.

Verification (type-check, tests, lint, asking the user to test) is part of your work steps, not session end. Include it where it makes sense for the changes you made.

### Session End

Session end is bookkeeping. Do not start until all work steps are complete.

1. Write session log to `.claude/sessions/YYYY-MM-DD.md`:
   ```
   ### HH:MM - [area/task]
   - Did: (1-3 bullets)
   - Files: (changed files)
   - Decisions: (what and why, include dropped tasks and why)
   - Next: (what remains / blockers)
   ```
2. Update `Current State` below if branch or in-progress work changed
3. Update `Recent Decisions` below if you made an architectural decision
4. If committing: session log and state updates MUST be in the same commit as the code they describe
<!-- END:TEMPLATE:session-protocol -->

<!-- BEGIN:TEMPLATE:never-guess -->
## Never Guess

If you do not have enough information to do something, ask. Do not guess. Do not infer. Do not fill in blanks with what seems reasonable.

A guessed value compounds through every downstream action. A guessed git identity becomes commits attributed to the wrong person. A guessed config value becomes a runtime error three sessions later. A guessed file path becomes a wasted investigation. Every guess costs time, money, and trust. The damage is not the guess itself: it is everything built on top of it.

If something is missing, broken, or unclear: stop and ask. A question costs one message. A guess costs everything downstream of it.
<!-- END:TEMPLATE:never-guess -->

<!-- BEGIN:TEMPLATE:prompt-delivery -->
## Prompt Delivery

Your assignment may have been dispatched from a prompt file in the fleet PM repo. If the user tells you the prompt source path, update its `Status` field in the YAML frontmatter at these points:

| When | Set Status to |
|------|---------------|
| Session start (after reading the prompt) | `received` |
| Starting development work | `in-progress` |
| Work suspended, will resume later | `paused` |
| All deliverables complete | `completed` |

Only update the `Status` field. Do not modify any other frontmatter or prompt content. The PM handles all other prompt tracking.
<!-- END:TEMPLATE:prompt-delivery -->

<!-- BEGIN:REPO:current-state -->
## Current State
Branch: `feature/154-155-scrollback-ux`
In-progress: PR shellicar/claude-cli#157 open, auto-merge enabled. Awaiting CI and merge.
<!-- END:REPO:current-state -->

<!-- BEGIN:REPO:architecture -->
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
| `src/mcp/shellicar/autoApprove.ts` | Glob-based auto-approve for exec commands (`execAutoApprove` config) |
| `docs/sdk-findings.md` | SDK behaviour discoveries (session semantics, tool options, etc.) |
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
## Recent Decisions

- **Structured command execution via in-process MCP** (#99) — replaced freeform Bash with a structured Exec tool served by an in-process MCP server. Glob-based auto-approve (`execAutoApprove`) with custom zero-dep glob matcher (no minimatch dependency).
- **Exec tool extracted to `@shellicar/mcp-exec`** — schema, executor, pipeline, validation rules, and ANSI stripping moved to a published package. CLI retains only `autoApprove.ts` (CLI-specific config concern).
- **ZWJ sanitisation in layout pipeline**: `sanitiseZwj` strips U+200D before `wrapLine` measures width. Terminals render ZWJ sequences as individual emojis; `string-width` assumes composed form. Stripping at the layout boundary removes the mismatch.
<!-- END:REPO:recent-decisions -->

<!-- BEGIN:REPO:extra -->
<!-- END:REPO:extra -->
