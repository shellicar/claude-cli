# claude-cli

A terminal-friendly Claude Code CLI built on the Claude Agent SDK — without React Ink.

## Why

The official Claude Code CLI uses React Ink for its TUI, which re-renders the entire terminal on every state change. In tmux (especially on WSL2), this floods the PTY with escape sequences and can deadlock the kernel write lock, freezing not just the session but the entire tmux server and sometimes the whole system.

This CLI uses the SDK directly with plain terminal I/O. No virtual DOM, no full re-renders, no PTY flooding.

## Status

Proof of concept — functional but minimal.

## Features

### Working

- Send messages to Claude via the Agent SDK
- Stream responses to stdout
- Multiline input — Enter inserts newline, Ctrl+Enter sends
- Word-level editing — Ctrl+Backspace/Delete, Ctrl+Left/Right
- Home/End, Ctrl+Home/End cursor navigation
- Waiting indicator with elapsed time during SDK calls
- Session resumption (`/session` to view, `/session <id>` to switch)
- `/quit` / `/exit`

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

- [ ] Cost tracking — display session cost from SDK result messages
- [ ] Context window usage — show token count and percentage
- [ ] Model selection — configure which Claude model to use
- [ ] Escape to cancel — interrupt in-progress SDK operations

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

- [ ] View current session ID
- [ ] Switch sessions
- [ ] List recent sessions

#### Quality of Life

- [ ] Message queueing — type while Claude is responding, messages execute sequentially
- [ ] Configurable settings (persisted)
- [ ] `/help` or `?` command listing

## Architecture

- **Node.js + TypeScript** — required for the Claude Agent SDK
- **Raw stdin** — no TUI framework, plain escape sequence rendering
- **`@anthropic-ai/claude-agent-sdk`** — session management, tool orchestration, compaction
- **`@anthropic-ai/claude-code`** — provides the claude executable

## Development

```bash
pnpm install
pnpm dev        # Run with tsx
pnpm build      # Bundle with esbuild
pnpm start      # Run built bundle
```
