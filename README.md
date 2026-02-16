# claude-cli

A terminal-friendly Claude Code CLI built on the Claude Agent SDK — without React Ink.

## Why

The official Claude Code CLI uses React Ink for its TUI, which re-renders the entire terminal on every state change. In tmux (especially on WSL2), this floods the PTY with escape sequences and can deadlock the kernel write lock, freezing not just the session but the entire tmux server and sometimes the whole system.

This CLI uses the SDK directly with plain terminal I/O. No virtual DOM, no full re-renders, no PTY flooding.

## Status

Proof of concept — functional and actively used for development.

## Features

### Working

- Send messages to Claude via the Agent SDK
- Stream responses to stdout
- Multiline input — Enter inserts newline, Ctrl+Enter sends
- Word-level editing — Ctrl+Backspace/Delete, Ctrl+Left/Right
- Home/End, Ctrl+Home/End cursor navigation
- Waiting indicator with elapsed time during SDK calls
- Session resumption (`/session` to view, `/session <id>` to switch)
- Auto-resume — persists session ID to `.claude/cli-session`, automatically resumes on restart
- Session portability — sessions created by the official CLI or VS Code extension can be resumed (same cwd required)
- `/quit` / `/exit`
- Auto-approve edits — Edit/Write tools for files inside `cwd` are auto-approved, files outside prompt for confirmation
- Coloured diff display — Edit tool calls show a unified diff instead of raw JSON
- Permission queue with timeout — concurrent tool permission requests are queued, 5 minute timeout per prompt
- Audit log — all SDK events written to `.claude/audit.jsonl` for debugging (`tail -f .claude/audit.jsonl` in another tmux pane)
- Cost/turns/duration display on result messages

### Terminal Setup

Ctrl+Enter requires custom keybindings in your terminal — most terminals send the same byte (`\r`) for both Enter and Ctrl+Enter.

**Windows Terminal** — add to `settings.json`:

```json
{
    "command": { "action": "sendInput", "input": "\u001b[13;5u" },
    "id": "User.sendInput.CTRL_ENTER"
}
```

```json
{ "id": "User.sendInput.CTRL_ENTER", "keys": "ctrl+enter" }
```

**VS Code** — add to `keybindings.json`:

```json
{
    "key": "ctrl+enter",
    "command": "workbench.action.terminal.sendSequence",
    "args": { "text": "\u001b[13;5u" },
    "when": "terminalFocus"
}
```

### Planned

#### Core

- [x] Cost tracking — display session cost from SDK result messages
- [x] Context window usage — show token count/percentage on result messages
- [ ] Configurable auto-compact threshold (official CLI uses 80%)
- [ ] Model selection — configure which Claude model to use
- [x] Escape to cancel — interrupt in-progress SDK operations
- [ ] Capture SDK stderr — the SDK process can exit with code 1 and no event data. Capture stderr for real error messages (already implemented in simple-claude-bot, can reference)
- [ ] Extra directories — `/add-dir` command to add additional directories to the session context
- [x] `/compact-at <uuid>` — compact at a specific message boundary by UUID, for recovering from context overflow
- [x] Context usage display — shows token count and percentage of context window on result messages
- [x] Skip `stream_event` from audit log — prevents audit.jsonl blowout (was ~50% of all entries)

#### Stream Events & Status

The SDK emits `stream_event` messages containing Anthropic API streaming events (`message_start`, `content_block_start`, `content_block_delta`, etc.) and `system` messages with subtypes like `compacting`. Currently silenced, but useful for:

- [ ] **Activity indicators** — use `stream_event` deltas for real-time "thinking..." / typing animation / spinner, via `includePartialMessages` SDK option
- [ ] **System status display** — surface `system` subtypes (`compacting`, `init`, etc.) in the status zone so you can see what the SDK is doing internally
- [ ] **Streaming text preview** — optionally show partial assistant text as it arrives (before the full `assistant` message)

#### Audit Log as Context Transfer

The audit log (`.claude/audit.jsonl`) is a complete record of all SDK events — assistant messages, tool calls, tool results, system events. This makes it useful beyond debugging:

- Paste relevant entries to another Claude for instant context on what happened
- Replay/review sessions after the fact
- Feed into dashboards or analytics

#### Permissions & Settings

Auto-approve tiers for tool calls:

- [x] **Auto-approve reads** — Read/Glob/Grep/WebSearch/LS auto-approved without prompting
- [x] **Auto-approve in cwd** — Edit/Write inside cwd auto-approved, Bash with safe patterns (TODO)
- [ ] **Bash safety — normalise, match, decide** (see below)
- [ ] `CLAUDE.md` injection — read `~/.claude/CLAUDE.md` and project-level `.claude/CLAUDE.md`, pass as system prompt
- [ ] Auto-generated system prompt — generate a prompt snippet from config/safe lists so Claude knows what's auto-approved, what's blocked, and doesn't use unnecessary flags (e.g. `git -C` when already in the right cwd)
- [x] Hooks support — enabled via `settingSources`, `PreToolUse` hooks fire from settings.json (e.g. block_dangerous_commands.sh)
- [x] Skills support — enabled via `settingSources`, skills load and are invokable (e.g. `/git-commit`)
- [ ] Persisted config file — back `config.ts` with a file (e.g. `~/.claude-cli/config.json`)
- [x] `allowedTools` SDK option — Read/Glob/Grep/LS auto-approved at SDK level (bypasses `canUseTool` entirely)

#### `AskUserQuestion` Tool

The SDK's `AskUserQuestion` tool presents interactive questions with selectable options. Key findings:

- `allowedTools` has **no effect** — the tool always goes through `canUseTool` regardless
- Without a handler in `canUseTool`, it hits the raw permission prompt (`Allow? y/n`)
- Denying returns `"User denied"` as the tool result
- Approving returns an empty response (no interactive UI to capture the selection)
- **Blocker for skills** that use `AskUserQuestion` (e.g. `git-commit` skill asks to confirm staging/commit message)

To properly support this:

- [x] Auto-approve `AskUserQuestion` in `canUseTool`
- [x] Render questions and options as an interactive terminal prompt
- [x] Capture user selection and return it as the tool result
- [x] "Other" free-text option with inline text editing
- [ ] Handle `multiSelect` mode (checkboxes vs radio)

#### Skill-Aware Auto-Approve

When a skill workflow is active (e.g. `/git-commit`), user decisions made via `AskUserQuestion` can be used to auto-approve subsequent tool calls — building a trust chain from user intent through to execution.

**Example: git-commit workflow**

1. User approves staging files → auto-approve `git add` for those exact files
2. User approves commit message "XYZ" → auto-approve `git commit -m "XYZ"` (exact match only)
3. Workflow reaches push step → auto-approve `git push` (no force flags)

Each auto-approve is derived from a previous user decision, not blind trust. Anything outside the expected workflow still prompts normally.

**Implementation needs:**

- [ ] Workflow context tracker — active skill, current step, accumulated user decisions
- [ ] Expected-next-command matcher in `canUseTool` — compare incoming tool call against what the workflow predicts
- [ ] Skills declare step sequences (or the CLI infers them from the tool call pattern)
- [ ] Safety constraints — only auto-approve non-destructive variants (e.g. `git push` but never `git push --force`)

#### Bash Safety (`bash-safety.ts`)

Approving every Bash command is actually less safe than smart auto-approve — approval fatigue means you stop reading and just mash `y`. The goal is reducing noise so you only need to pay attention to genuinely ambiguous commands.

**Flow: Normalise → Match → Decide**

1. **Normalise** — resolve cwd-override flags before matching:
   - `git -C /path status` → normalise to `git status` (with adjusted cwd)
   - `pnpm --dir /path install` → normalise to `pnpm install`
   - Strip cosmetic flags: `--color=always`, `--no-pager`, etc.
2. **Match** against three tiers:
   - **Green (auto-approve)** — read-only commands: `git status`, `git log`, `git diff`, `git show`, `git branch`, `ls`, `pwd`, `cat`, `head`, `tail`, `wc`, `echo`, `node --version`, `pnpm outdated`, `pnpm why`, etc.
   - **Red (auto-deny)** — destructive commands: `rm -rf`, `git push --force`, `git checkout .`, `git reset --hard`, `git clean`, `find...-delete`, `chmod -R`, etc.
   - **Yellow (prompt)** — everything else, user decides
3. **Chain detection** — commands with `&&`, `||`, `;`, `|` are either split and each part matched individually, or the whole thing goes to prompt. Prevents bypass like `git log; rm -rf /`.

This handles ~95% of cases. The remaining 5% get prompted, but now you're actually reading those prompts because there are only a few per session.

#### Smart Auto-Compact

Automatic compaction at a configurable context window threshold (default ~80%), with three modes:

- [ ] **Default** — standard SDK compaction behaviour
- [ ] **Custom prompt** — user provides instructions for what to preserve
- [ ] **Claude-generated prompt** — ask the active Claude to generate the compaction summary (best results, since it knows the conversation context)
- [ ] `/compact` — manual compact command

Remembers the last selected mode. Prevents the "forgot to compact and ran out of context" problem.

#### Command Mode

Separate input context for CLI commands, activated by a key combo (TBD). Prompt buffer is preserved while in command mode.

- [ ] Command palette with available commands
- [ ] Tab completion / filtering
- [ ] No `/` prefix ambiguity — commands and chat input are separate contexts

#### Session Management

- [x] View current session ID
- [x] Switch sessions
- [ ] List recent sessions

#### Global Session Dashboard

Central view of all Claude sessions across projects. Session data lives in `~/.claude/projects/` as `.jsonl` files — this feature would parse and present them.

- [ ] List all sessions across all projects
- [ ] Show session metadata — working directory, duration, context size, model, cost
- [ ] Filter/search by project, date, or session content
- [ ] Quick switch — resume any session from the dashboard
- [ ] Session health — identify sessions nearing context limits
- [ ] Prune/archive old sessions

#### Terminal Rendering Zones

The terminal needs three independent rendering zones to prevent output from clobbering prompts:

1. **History zone** (top, scrollable) — logged messages, tool results, assistant text, diffs. Permanent and append-only.
2. **Status/prompt zone** (bottom, fixed) — permission prompts ("Allow? y/n"), waiting indicators, progress. Always visible, replaces itself. Must stay at the bottom even when history updates above it.
3. **Input zone** (very bottom, fixed) — the user's text editor area.

Currently everything is dumped sequentially to stdout, so when parallel tool calls come in, the permission prompt gets buried under tool results and you can't tell what you're approving. This is the core rendering problem to solve.

Scrolling is handled by the terminal/tmux — the CLI doesn't need to manage it. History is just appended to stdout normally. The key is: after writing to history, redraw the fixed status/input area at the bottom.

Approach: ANSI cursor positioning — save/restore cursor, write history, then redraw status + input at the bottom. Core escape sequences: `\x1B[s`/`\x1B[u` (save/restore), `\x1B[<n>A`/`\x1B[<n>B` (move up/down), `\x1B[2K` (clear line). Could use `ansi-escapes` npm package as a clean wrapper, or just raw sequences — the logic is more important than the abstraction. No heavy TUI framework (blessed, terminal-kit are both unmaintained).

- [ ] Implement zone-based rendering with fixed status/prompt area
- [ ] Ensure permission prompt is always the latest visible line
- [ ] Multi-line paste support — currently pastes corrupt the editor state/line management
- [ ] Escape during permission prompt — pressing Escape returns to the input prompt but the permission callback remains pending, leaving the session in an inconsistent state. Escape should either deny the pending permission or cancel the entire query.

#### Input & UX

- [ ] Type-ahead — write the next message while Claude is still responding, send on completion (separate from message queueing)
- [ ] Message queueing — queue multiple messages, execute sequentially
- [ ] Tmux pane title integration — send status to tmux via `\033]2;...\033\\` escape sequences (similar to existing dotfiles `.prompt` pattern: `?` for pending, `O` for success, `X` for failure)
- [ ] Configurable settings (persisted)
- [ ] `/help` or `?` command listing

#### Refactoring

- [ ] Extract message rendering — the `switch` block in the message handler is growing, move to its own module
- [ ] Extract permission handling — queue, timer, and `canUseTool` logic into `permissions.ts`
- [ ] Slim down `index.ts` — currently handles editor, permissions, rendering, session management, keyboard, and startup

## SDK vs CLI Findings

Through testing, we discovered the boundary between what the Claude Agent SDK handles vs what the official CLI handles on top.

### `settingSources` option

Adding `settingSources: ['local', 'project', 'user']` to SDK options enables:

- ✅ Skills loaded and invokable (git-commit, github-pr, etc.)
- ✅ `PreToolUse` hooks firing (block_dangerous_commands.sh)
- ✅ Settings.json being read
- ✅ File change notifications (system reminders)
- ✅ `permissions.deny` rules — confirmed working! Adding `"Bash"` and `"Edit"` to deny gives explicit `Error: No such tool available` when Claude tries to use them. Tools not in deny still work normally. (Clean retest with no `tools` option in code.)
- ✅ Plugins loaded — audit log confirms `typescript-lsp` and `agent-sdk-dev` plugins are loaded in the init event, though LSP tool not directly observed
- ❓ CLAUDE.md — SDK docs say `'project'` is required (which we have), but injection not confirmed. May be loading but not obvious without the protocol skills being invoked.
- ❓ `permissionMode` from settings.json — audit log shows `"permissionMode": "default"` even though settings.json has `"defaultMode": "acceptEdits"`. The SDK option `permissionMode` must be passed explicitly in code; it does not read `defaultMode` from settings.json.

**Important**: `allowedTools`, `tools`, and `disallowedTools` are different SDK options:
- `allowedTools: ['Edit']` — Edit auto-approves without prompting (all tools still available)
- `tools: ['Bash', 'Read']` — whitelist: ONLY Bash and Read exist (restricts available tools)
- `tools: []` — SDK init confirms `"tools": []`, Claude still sees tools in system prompt but cannot call any (silent failure — turns end immediately with no tool calls). Different from deny which gives explicit error.
- `disallowedTools: ['Bash']` — blacklist: removes specific tools from model context entirely, cannot be used even if otherwise allowed. Use for blocking dangerous tools.

### SDK Options discovered (from `sdk.d.ts`)

Key options available but not yet fully utilised:

- **`permissionMode`** — `'acceptEdits'`, `'dontAsk'`, `'bypassPermissions'`, etc. SDK-level permission mode (we implement our own hybrid via `canUseTool`)
- **`allowedTools`** — array of tool names that auto-allow without prompting
- **`disallowedTools`** — array of tool names to remove from model context entirely (blacklist)
- **`includePartialMessages`** — when true, emits `SDKPartialAssistantMessage` events during streaming. Useful for activity indicators even if content isn't shown.
- **`stderr`** — callback `(data: string) => void` for capturing SDK process errors. Solves "exited with code 1 with no info" problem
- **`systemPrompt`** — supports `{ type: 'preset', preset: 'claude_code', append: '...' }` to keep default prompt and add custom context
- **`hooks`** — programmatic hook callbacks (not just from settings.json)
- **`agents`** — define custom subagents programmatically for the Task tool
- **`plugins`** — `[{ type: 'local', path: './my-plugin' }]`
- **`debug` / `debugFile`** — built-in debug logging
- **`enableFileCheckpointing`** — track and rewind file changes
- **`thinking`** — `{ type: 'adaptive' }` for Opus 4.6 adaptive thinking
- **`effort`** — `'low'` | `'medium'` | `'high'` | `'max'` for thinking depth
- **`maxBudgetUsd`** — cost cap per query
- **`betas`** — `'context-1m-2025-08-07'` for 1M context window (Sonnet 4/4.5)

### SDK handles

- Tool definitions (what tools are available)
- JSON schema validation on `settings.json` edits (prevents invalid JSON)
- Some built-in auto-approvals for safe read-only commands (e.g. `git show`, `git log`, `pwd`)
- Skills loading and invocation (via `settingSources`)
- Hooks execution (via `settingSources`)

### Requires `settingSources` (not loaded by default)

- `permissions.deny` — removes tools entirely with explicit error
- `permissions.allow` — pattern matching (untested, likely works)
- Skills, hooks, plugins, file change notifications

### CLI-only (not available via SDK)

- `defaultMode` from settings.json (SDK has its own `permissionMode` option which must be passed in code)
- UI features (spinnerVerbs, statusLine, promptSuggestions, etc.)

### Implications

The `canUseTool` callback is your **entire** permission system when using the SDK directly. The SDK hands you every tool call and you decide. Our hybrid approach: SDK handles hooks and settings via `settingSources`, while `canUseTool` provides auto-approve tiers (reads, safe bash, edits in cwd) with manual prompt as fallback.

Sessions are keyed by `sessionId + cwd`. A session created from one directory cannot be resumed from another, even with the same session ID.

## Architecture

- **Node.js + TypeScript** — required for the Claude Agent SDK
- **Raw stdin** — no TUI framework, plain escape sequence rendering
- **`@anthropic-ai/claude-agent-sdk`** — session management, tool orchestration, compaction
- **`@anthropic-ai/claude-code`** — provides the claude executable
- **`.claude/audit.jsonl`** — all SDK events logged for debugging, viewable via `tail -f` in a separate pane
- **`config.ts`** — in-memory config with `autoApproveEdits` (to be backed by a file later)

## Development

```bash
pnpm install
pnpm dev        # Run with tsx
pnpm build      # Bundle with esbuild
pnpm start      # Run built bundle
```
