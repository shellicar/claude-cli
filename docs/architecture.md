# Architecture

## Overview

Node.js + TypeScript CLI built on the Claude Agent SDK. Uses raw stdin with plain ANSI escape sequences — no TUI framework (React Ink, blessed, terminal-kit).

## Core Components

- **`ClaudeCli`** — main entry point, orchestrates session lifecycle
- **`AppState`** — phase management (`idle`, `sending`, `thinking`, `prompting`, `asking`)
- **`Terminal`** — ANSI rendering with status line, sticky prompt area, coloured output
- **`PromptManager`** — handles `AskUserQuestion` tool with interactive selection and configurable timeout
- **`PermissionManager`** — tool permission queue with configurable timeouts and drowning alert
- **`SystemPromptBuilder`** — modular provider system for composing the system prompt append per query
- **`AuditWriter`** — all SDK events logged to `.claude/audit.jsonl` for debugging
- **`AttachmentStore`** — unified store for image and text attachments

## System Prompt Providers

The system prompt append uses a modular provider architecture (`SystemPromptProvider` interface + `SystemPromptBuilder`). Each provider contributes sections and can be independently enabled/disabled. Providers run in parallel via `Promise.all`.

Current providers:
- **`UsageProvider`** — current time, elapsed since last response, context usage %, session cost
- **`GitProvider`** — current branch, working tree dirty/clean status

## Terminal Rendering

Three logical zones:
1. **History zone** (top, scrollable) — logged messages, tool results, assistant text, diffs. Append-only.
2. **Status/prompt zone** (bottom, fixed) — permission prompts, waiting indicators, progress. Always visible.
3. **Input zone** (very bottom, fixed) — the user's text editor area.

Uses ANSI cursor positioning — save/restore cursor, write history, then redraw status + input at the bottom. No heavy TUI framework.

## Permission System

The `canUseTool` callback is the entire permission system when using the SDK directly. The SDK hands every tool call and the CLI decides.

Hybrid approach:
- SDK handles hooks, settings, and bash permissions via `settingSources`
- `canUseTool` provides auto-approve tiers (reads, edits in cwd) with manual prompt as fallback
- `allowedTools` SDK option auto-approves Read/Glob/Grep/LS at SDK level

## Session Management

- Sessions keyed by `sessionId + cwd` — a session from one directory cannot be resumed from another
- Auto-resume via `.claude/cli-session` file
- Portable sessions — can resume sessions from the official CLI or VS Code extension

## Command Mode

Activated via `Ctrl+/`. Provides key-driven actions without text-based `/commands`:
- Clipboard paste (image `i`, text `t`)
- Attachment management (delete `d`, preview `p`, navigate `←→`)
- Preserves editor buffer while active

## Audit Log

All SDK events written to `.claude/audit.jsonl`. Useful for:
- Debugging SDK interactions (`tail -f .claude/audit.jsonl`)
- Context transfer — paste entries to another Claude for instant context
- Session replay and review
