# @shellicar/mcp-memory

> Persistent memory for Claude, shared across every session and project.

[![npm package](https://img.shields.io/npm/v/@shellicar/mcp-memory.svg)](https://npmjs.com/package/@shellicar/mcp-memory)
[![build status](https://github.com/shellicar/claude-cli/actions/workflows/node.js.yml/badge.svg)](https://github.com/shellicar/claude-cli/actions/workflows/node.js.yml)

## Features

- 🧠 **Persists across sessions** - what one conversation learns, the next can find, with no shared context required.
- 🔎 **Relevance search, not recall by id** - describe what you need in plain words; ranked hits come back, best first.
- 💾 **Own data directory** - respects XDG on Linux, and the platform convention elsewhere, independent of any CLI's own state.
- 🔌 **stdio transport** - drop it into any MCP client that speaks stdio.

## Installation & Quick Start

```sh
npm i -g @shellicar/mcp-memory
```

```sh
pnpm add -g @shellicar/mcp-memory
```

It runs as a stdio MCP server under the `mcp-memory` command. Point your MCP client at it:

```json
{
  "mcpServers": {
    "memory": {
      "command": "mcp-memory"
    }
  }
}
```

## Motivation

Claude's context doesn't survive between sessions. Anthropic's own documented pattern for multi-session work is a progress log and checklist file, re-read at the start of each session, but that's just a work-log: it tells you what was done, not the trap that was hit, the decision that was made and why, or the correction to something Claude believed wrong. This gives Claude somewhere to write those down and search them back up later, in any session, on any project, not just the one where it was written.

## Storage

Memories live in a SQLite file, `memory.db`, under the platform's standard data directory for `shellicar-mcp-memory`. `$XDG_DATA_HOME`, if set, wins on every platform, not just Linux:

- **`$XDG_DATA_HOME` set** - `$XDG_DATA_HOME/shellicar-mcp-memory`
- **Linux** - `~/.local/share/shellicar-mcp-memory`
- **macOS** - `~/Library/Application Support/shellicar-mcp-memory`
- **Windows** - `%LOCALAPPDATA%\shellicar-mcp-memory`

Each memory is stamped with the git remote of the working directory it was written from, when available, so a search hit can announce where it came from.

## Credits & Inspiration

- [Model Context Protocol](https://modelcontextprotocol.io)
