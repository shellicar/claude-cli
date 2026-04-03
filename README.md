# @shellicar/claude-cli

> A terminal-friendly Claude Code CLI built on the Claude Agent SDK, without React Ink.

[![npm package](https://img.shields.io/npm/v/@shellicar/claude-cli.svg)](https://npmjs.com/package/@shellicar/claude-cli)
[![build status](https://github.com/shellicar/claude-cli/actions/workflows/node.js.yml/badge.svg)](https://github.com/shellicar/claude-cli/actions/workflows/node.js.yml)

<!-- BEGIN_ECOSYSTEM -->
<!-- END_ECOSYSTEM -->

## Packages

- [`@shellicar/claude-cli`](packages/claude-cli) - Terminal Claude Code CLI with plain terminal I/O
- [`@shellicar/claude-sdk`](packages/claude-sdk) - Minimal agent SDK built on the Messages API

## Motivation

The official Claude Code CLI uses React Ink for its TUI, which re-renders the entire terminal on every state change. In tmux (especially on WSL2), this floods the PTY with escape sequences and can deadlock the kernel write lock.

This CLI talks to the SDK directly with plain terminal I/O. No React, no virtual DOM, no PTY flooding.

## Installation

```sh
pnpm add -g @shellicar/claude-cli
```

## Features

- Multiline editor with word-level editing, Home/End, Ctrl+Home/End
- Session resumption and auto-resume across restarts
- Portable sessions, resumable from the official CLI or VS Code extension
- Configurable auto-approve tiers (reads, edits in cwd)
- Permission queue with configurable timeouts and drowning alert
- Coloured diff display for Edit tool calls
- Cost, context usage, and elapsed time tracking
- System prompt providers (git branch/status, context %, session cost, current time)
- Command mode (Ctrl+/) with clipboard image/text paste, attachment preview
- Interactive question prompts with configurable timeout
- Audit log for debugging (`.claude/audit.jsonl`)
- Skills and hooks support via `settingSources`

## Terminal Setup

Ctrl+Enter requires a custom keybinding. Most terminals send the same byte for Enter and Ctrl+Enter.

**Windows Terminal**: add to `settings.json`:

```json
{
    "command": { "action": "sendInput", "input": "\\u001b[13;5u" },
    "id": "User.sendInput.CTRL_ENTER"
}
```

```json
{ "id": "User.sendInput.CTRL_ENTER", "keys": "ctrl+enter" }
```

**VS Code**: add to `keybindings.json`:

```json
{
    "key": "ctrl+enter",
    "command": "workbench.action.terminal.sendSequence",
    "args": { "text": "\\u001b[13;5u" },
    "when": "terminalFocus"
}
```

## Configuration

Config file at `~/.claude/cli-config.json`. Run `claude-cli --init-config` to create defaults.

Key options: `model`, `maxTurns`, `permissionTimeoutMs`, `extendedPermissionTimeoutMs`, `questionTimeoutMs`, `drowningThreshold`, `autoApproveEdits`, `autoApproveReads`, `providers`.

## Development

```sh
pnpm install
pnpm dev        # Run with tsx
pnpm build      # Bundle with esbuild
pnpm start      # Run built bundle
pnpm test       # Run tests
pnpm type-check # TypeScript type checking
```
