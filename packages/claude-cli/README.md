# @shellicar/claude-cli

> A terminal-friendly Claude Code CLI built on the Claude Agent SDK, without React Ink.

[![npm package](https://img.shields.io/npm/v/@shellicar/claude-cli.svg)](https://npmjs.com/package/@shellicar/claude-cli)
[![build status](https://github.com/shellicar/claude-cli/actions/workflows/node.js.yml/badge.svg)](https://github.com/shellicar/claude-cli/actions/workflows/node.js.yml)

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

## Installation

```sh
pnpm add -g @shellicar/claude-cli
```

## Motivation

The official Claude Code CLI uses React Ink for its TUI, which re-renders the entire terminal on every state change. In tmux (especially on WSL2), this floods the PTY with escape sequences and can deadlock the kernel write lock.

This CLI talks to the SDK directly with plain terminal I/O. No React, no virtual DOM, no PTY flooding.

## Terminal Setup

Ctrl+Enter requires a custom keybinding in most terminals. See the [GitHub repository](https://github.com/shellicar/claude-cli) for setup instructions.

## Configuration

Config file at `~/.claude/cli-config.json`. Run `claude-cli --init-config` to create defaults.

Key options: `model`, `maxTurns`, `permissionTimeoutMs`, `extendedPermissionTimeoutMs`, `questionTimeoutMs`, `drowningThreshold`, `autoApproveEdits`, `autoApproveReads`, `providers`.
