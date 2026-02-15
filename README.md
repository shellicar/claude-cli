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
- Auto-resume — persists session ID to `.claude-cli-session`, automatically resumes on restart
- Session portability — sessions created by the official CLI or VS Code extension can be resumed (same cwd required)
- `/quit` / `/exit`
- Auto-approve edits — Edit/Write tools for files inside `cwd` are auto-approved, files outside prompt for confirmation
- Coloured diff display — Edit tool calls show a unified diff instead of raw JSON
- Permission queue with timeout — concurrent tool permission requests are queued, 5 minute timeout per prompt
- Audit log — all SDK events written to `audit.jsonl` for debugging (`tail -f audit.jsonl` in another tmux pane)
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
- [ ] Context window usage — show token count and percentage
- [ ] Model selection — configure which Claude model to use
- [x] Escape to cancel — interrupt in-progress SDK operations

#### Permissions & Settings

- [ ] `CLAUDE.md` injection — read `~/.claude/CLAUDE.md` and project-level `.claude/CLAUDE.md`, pass as system prompt
- [ ] Hooks support — read `PreToolUse`/`PostToolUse` hooks from settings and pass to SDK
- [ ] Skills support — SDK currently does not expose CLI skills (e.g. `/git-commit`), investigate SDK API
- [ ] Persisted config file — back `config.ts` with a file (e.g. `~/.claude-cli/config.json`)

#### Command Mode

Separate input context for CLI commands, activated by a key combo (TBD). Prompt buffer is preserved while in command mode.

- [ ] Command palette with available commands
- [ ] Tab completion / filtering
- [ ] No `/` prefix ambiguity — commands and chat input are separate contexts

#### Smart Auto-Compact

Automatic compaction at a configurable context window threshold, with three modes:

- [ ] **Default** — standard SDK compaction behaviour
- [ ] **Custom prompt** — user provides instructions for what to preserve
- [ ] **Claude-generated prompt** — ask the active Claude to generate the compaction summary (best results, since it knows the conversation context)

Remembers the last selected mode. Prevents the "forgot to compact and ran out of context" problem.

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

#### Quality of Life

- [ ] Message queueing — type while Claude is responding, messages execute sequentially
- [ ] Configurable settings (persisted)
- [ ] `/help` or `?` command listing

#### Refactoring

- [ ] Extract message rendering — the `switch` block in the message handler is growing, move to its own module
- [ ] Extract permission handling — queue, timer, and `canUseTool` logic into `permissions.ts`
- [ ] Slim down `index.ts` — currently handles editor, permissions, rendering, session management, keyboard, and startup

## SDK vs CLI Findings

Through testing, we discovered the boundary between what the Claude Agent SDK handles vs what the official CLI handles on top:

### SDK handles

- Tool definitions (what tools are available)
- JSON schema validation on `settings.json` edits (prevents invalid JSON)
- Some built-in auto-approvals for safe read-only commands (e.g. `git show`, `git log`)

### CLI-only (not SDK)

- `permissions.allow` / `permissions.deny` pattern matching from `settings.json`
- `defaultMode` (`acceptEdits`, `dontAsk`, `bypassPermissions`, etc.)
- `PreToolUse` / `PostToolUse` hooks (must be passed manually via SDK options)
- Skills (e.g. `/git-commit`) — not exposed through the SDK
- `CLAUDE.md` injection — not automatic, must be read and passed manually
- Removing tools from the tool list based on deny rules

### Implications

The `canUseTool` callback is your **entire** permission system when using the SDK directly. The SDK hands you every tool call and you decide. This is simpler in some ways — no fighting SDK permission logic — but means all permission features must be implemented client-side.

Sessions are keyed by `sessionId + cwd`. A session created from one directory cannot be resumed from another, even with the same session ID.

## Architecture

- **Node.js + TypeScript** — required for the Claude Agent SDK
- **Raw stdin** — no TUI framework, plain escape sequence rendering
- **`@anthropic-ai/claude-agent-sdk`** — session management, tool orchestration, compaction
- **`@anthropic-ai/claude-code`** — provides the claude executable
- **`audit.jsonl`** — all SDK events logged for debugging, viewable via `tail -f` in a separate pane
- **`config.ts`** — in-memory config with `autoApproveEdits` (to be backed by a file later)

## Development

```bash
pnpm install
pnpm dev        # Run with tsx
pnpm build      # Bundle with esbuild
pnpm start      # Run built bundle
```
