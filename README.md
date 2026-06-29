# @shellicar/claude-sdk-cli

> A terminal-native alternative to Claude Code that talks to the Messages API directly.

[![npm package](https://img.shields.io/npm/v/@shellicar/claude-sdk-cli.svg)](https://npmjs.com/package/@shellicar/claude-sdk-cli)
[![build status](https://github.com/shellicar/claude-cli/actions/workflows/node.js.yml/badge.svg)](https://github.com/shellicar/claude-cli/actions/workflows/node.js.yml)

<!-- BEGIN_ECOSYSTEM -->
<!-- END_ECOSYSTEM -->

## Features

- 🧩 **Composable tools** - Small read, search, and edit tools that chain together with `Pipe`, so one tool's output feeds the next without routing every result back through Claude.
- ⚙️ **Structured command execution** - Run commands through a typed schema instead of Bash.
- 🔎 **TypeScript tools** - Diagnostics, hover, references, and go-to-definition from the language server.
- 🧠 **Visible thinking** - See Claude think, live and after the fact. Claude Code does not surface it.
- 🗂️ **Flat JSONL conversations** - Read, edit, and process them yourself.
- ⌨️ **Command mode** - A key-driven menu (`Ctrl+/`) for sessions, attachments, and model settings.
- 🛡️ **Simple permissions** - A six-cell grid over read, write, and delete, inside and outside the working directory.

## Why you might want this

Claude Code is an excellent tool, and for most people it is the right one. Reach for this if you use Claude Code but want to:

- customise the system prompt, with `--system` or in config
- drive a whole session from command-line arguments, with `--config`, `--prompt`, and `--model`

It has fewer built-in features than Claude Code, on purpose: a small set of composable tools to build around rather than a large set of built-ins. It is not for you if you need the features it does not have, including MCP, plugins, subagents, and automatic skills.

## Installation

```sh
npm i -g @shellicar/claude-sdk-cli
```

```sh
pnpm add -g @shellicar/claude-sdk-cli
```

The CLI ships as a single executable bundling its own Node runtime, delivered through a per-platform package so only the binary for your platform installs. On first run it opens your browser to sign in with your Claude account (see [Authentication](#authentication)), then saves your credentials for later runs.

Start it from any directory:

```sh
claude-sdk-cli
```

## Motivation

Claude Code's terminal interface is built with React Ink, which repaints the whole screen on every change. Under WSL2 inside tmux, that repainting could freeze my machine. So I built a terminal client that talks to the Messages API directly, with plain terminal output and no full-screen repaint, on my own [`@shellicar/claude-sdk`](packages/claude-sdk).

This CLI is the result. It does less than Claude Code, and that is the point: a small set of composable tools I can build around.

## Configuration

Configuration lives in `sdk-config.json`, read from two places:

- `~/.claude/sdk-config.json` for your global settings
- `./.claude/sdk-config.json` in the current directory, which overlays the global file

Both are watched and reload while the CLI runs. Create a default file with `claude-sdk-cli --init-config`.

The keys you are most likely to set:

```json
{
  "$schema": "https://raw.githubusercontent.com/shellicar/claude-cli/main/schema/sdk-config.schema.json",
  "model": "claude-opus-4-8",
  "maxTokens": 32000,
  "thinking": {
    "enabled": true,
    "effort": "high"
  },
  "tools": {
    "exec": false,
    "execV2": true
  },
  "serverTools": {
    "webSearch": {
      "enabled": true
    },
    "webFetch": {
      "enabled": true
    }
  }
}
```

- `model` - the Claude model to use.
- `maxTokens` - maximum tokens per response.
- `thinking.enabled` - request extended thinking.
- `thinking.effort` - effort level: `low`, `medium`, `high`, `xhigh`, or `max`. See [Gotchas](#gotchas).
- `tools.exec` / `tools.execV2` - which execution tool to register. See [Gotchas](#gotchas).
- `serverTools.webSearch` / `serverTools.webFetch` - the server-side tools, both on by default.
- `claudeMd` - which CLAUDE.md files to load.
- `systemPrompt` - which SYSTEM.md files to load, plus inline prompt text.
- `historyReplay.showThinking` - replay past thinking blocks when a session reloads.
- `compact` - conversation compaction settings.
- `hooks` - run a command when an approval is pending.
- `permissions` - the approval grid (see [Permissions](#permissions)).

The `$schema` line gives you autocomplete and validation in an editor that understands JSON Schema.

## Usage

Run `claude-sdk-cli` with no arguments to start. By default it resumes the last session from the current directory; pass `--no-resume` to start fresh.

### Command-line arguments

| Flag | What it does |
|---|---|
| `--config <json>` | Override config with a JSON object, e.g. `'{"model":"..."}'`. |
| `--prompt <text>` | Send an initial message at launch. |
| `--model <model>` | Override the model for this session. |
| `--system <text>` | Set the system prompt, appended after SYSTEM.md and config text. |
| `--file <path>` | Attach a file as the first message. Repeat for several. |
| `--name <label>` | Display label for the session, shown in the status bar. |
| `--resume <id>` | Resume the conversation with this id. |
| `--no-resume` | Start fresh, skipping auto-resume. |
| `--init-config` | Write a default config to `~/.claude/sdk-config.json` and exit. |
| `--verify` | Check the install can boot, then exit. |
| `--version`, `-v` | Print the version and exit. |
| `--version-info` | Print detailed version information and exit. |
| `--help`, `-h` | Print usage and exit. |

### Command mode

Press `Ctrl+/` to open command mode: a key-driven menu, chosen deliberately over `/slash` commands so the actions stay in muscle memory. Each key runs an action; `Esc` steps back out.

- `t` - paste text from the clipboard
- `f` - paste a file path
- `i` - paste an image from the clipboard
- `n` - start a new session
- `m` - open the model menu, where `t` toggles thinking and `e` cycles effort
- `d` - remove the selected attachment
- `p` - toggle attachment preview
- `←` / `→` - select the previous or next attachment
- `Esc` - leave command mode

### Attachments

You can attach three kinds of clipboard content: an image, text, or a file path. Attachments show in the editor with their size, and `p` previews them before you send.

## Terminal Setup

Ctrl+Enter submits a message. Most terminals send the same byte for Enter and Ctrl+Enter, so it needs a custom keybinding.

**Windows Terminal**: add to `settings.json`:

```json
{
  "actions": [
    {
      "command": {
        "action": "sendInput",
        "input": "\\u001b[13;5u"
      },
      "id": "User.sendInput.CTRL_ENTER"
    }
  ],
  "keybindings": [
    {
      "id": "User.sendInput.CTRL_ENTER",
      "keys": "ctrl+enter"
    }
  ]
}
```

**VS Code**: add to `keybindings.json`:

```json
{
  "key": "ctrl+enter",
  "command": "workbench.action.terminal.sendSequence",
  "args": {
    "text": "\\u001b[13;5u"
  },
  "when": "terminalFocus"
}
```

On macOS, map `cmd+enter` to the same sequence:

```json
{
  "key": "cmd+enter",
  "command": "workbench.action.terminal.sendSequence",
  "args": {
    "text": "\\u001b[13;5u"
  },
  "when": "terminalFocus"
}
```

## Tools

The tools Claude can call:

- **Read and search**: `Find`, `Grep`, `SearchFiles`, `ReadFile` (text, PDFs, and images), and the slices `Head`, `Tail`, and `Range`, chained with `Pipe`.
- **Edit**: `PreviewEdit` and `EditFile`, `CreateFile`, `AppendFile`, `DeleteFile`, and `DeleteDirectory`.
- **Run commands**: `Exec` and `ExecV2`.
- **Page large output**: `Ref`.
- **TypeScript**: `TsDiagnostics`, `TsHover`, `TsReferences`, and `TsDefinition`.
- **Server tools**: web search and web fetch, run on Anthropic's infrastructure.

## Context files

The CLI supports `CLAUDE.md`, loaded from the same locations as Claude Code. It also supports `SYSTEM.md`, which works the same way but loads into the system prompt instead of the conversation.

## Permissions

Tool calls are approved against a six-cell grid: the three operations (read, write, delete) crossed with two zones (inside the working directory and outside it). Each cell is `approve`, `ask`, or `deny`. The defaults:

| Operation | Inside cwd | Outside cwd |
|---|---|---|
| read | approve | approve |
| write | approve | ask |
| delete | ask | deny |

Set these under `permissions` in `sdk-config.json`.

## Sessions

Conversations are stored as flat JSONL, one message per line, at `~/.claude/conversations/<id>.jsonl`. Sessions are keyed by id alone, not by directory, so you can resume one from anywhere:

```sh
cd some/other/dir && claude-sdk-cli --resume <id>
```

The current directory keeps a small marker for auto-resume; the conversation itself lives under your home directory. There is no fork or rewind: a session moves forward, and the file is rewritten each turn.

## Gotchas

- **The default execution tool is `ExecV2`.** It is on by default (`tools.execV2`) and takes a nested, recursive command structure that Claude finds hard to drive well. A flatter `Exec` tool ships alongside it; turn it on with `tools.exec`. A future V3 will replace both. Switching execution tools takes effect at startup, so restart after changing it.
- **`thinking.effort` is a misnomer:** effort is not specific to thinking. See Anthropic's [effort documentation](https://platform.claude.com/docs/en/build-with-claude/effort).
- **Tested with pnpm.** Other package managers should work but are unverified.

## Authentication

There is no API-key flow; it uses your own Claude account, like Claude Code. An API key, if you have one, goes in `~/.claude/.credentials.json` (the file `claude setup-token` writes).

## Files and storage

The CLI writes these on its own as you use it.

Under `~/.claude` (global):

- `.credentials.json` - your OAuth credentials, written on login.
- `conversations/<id>.jsonl` - the full transcript of each conversation.
- `audit/<id>.jsonl` - an audit record per conversation.
- `persistence.db` - a SQLite database holding Ref and edit-preview state across restarts.

Under `./.claude` (per directory):

- `.sdk-conversation-id` - the last session id here, for auto-resume.
- `.sdk-conversation-history` - an append-only list of session ids started here.

In the launch directory:

- `claude-sdk-cli.log` - a running log.

## Packages

- [`@shellicar/claude-sdk-cli`](apps/claude-sdk-cli) - the CLI itself.
- [`@shellicar/claude-sdk`](packages/claude-sdk) - the agent SDK over the Messages API that the CLI is built on.
- [`@shellicar/claude-sdk-tools`](packages/claude-sdk-tools) - the tool definitions the CLI registers.
- [`@shellicar/claude-core`](packages/claude-core) - shared filesystem, path, and terminal utilities.
- [`@shellicar/mcp-exec`](packages/mcp-exec) - an MCP server that exposes the Exec tool to any MCP client.
- [`@shellicar/exec-core`](packages/exec-core) - process execution used by the tools (internal).

## Development

```sh
pnpm install
pnpm dev        # run from source
pnpm build      # build every package
pnpm start      # run the built CLI
pnpm test       # run tests
pnpm type-check # type-check
```

The build runs through turbo: libraries build with tsup, the CLI app with esbuild. Formatting and linting use biome (`pnpm ci:fix`).
