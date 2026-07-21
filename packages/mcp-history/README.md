# @shellicar/mcp-history

> Give an LLM a memory of its own past conversations.

[![npm package](https://img.shields.io/npm/v/@shellicar/mcp-history.svg)](https://npmjs.com/package/@shellicar/mcp-history)
[![build status](https://github.com/shellicar/claude-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/shellicar/claude-cli/actions/workflows/ci.yml)

## Features

- 🔎 **Search past conversations** - full-text search over your own conversation history, with citations to the source.
- 📖 **Read a hit in context** - open a matched conversation with the surrounding turns, not just the snippet.
- 🗃️ **Own local index** - a dedicated SQLite index, built from your own conversation history.
- 🔌 **stdio transport** - drop it into any MCP client that speaks stdio.

## Installation & Quick Start

```sh
npm i -g @shellicar/mcp-history
```

```sh
pnpm add -g @shellicar/mcp-history
```

It runs as a stdio MCP server under the `mcp-history` command. Point your MCP client at it:

```json
{
  "mcpServers": {
    "history": {
      "command": "mcp-history"
    }
  }
}
```

## Motivation

This came out of a major version rewrite that ran over weeks of sessions. A requirement got dropped along the way, twice, and neither drop was written to memory, because nothing flagged it as worth noting at the time. Searching the actual conversation found it straight away.

Memory only holds what someone thought to write down. Conversation search holds what was actually said.

## Storage

The index lives in a SQLite file, `history.db`, under the platform's standard data directory for `shellicar-mcp-history`. `$XDG_DATA_HOME`, if set, wins on every platform, not just Linux:

- **`$XDG_DATA_HOME` set** - `$XDG_DATA_HOME/shellicar-mcp-history`
- **Linux** - `~/.local/share/shellicar-mcp-history`
- **macOS** - `~/Library/Application Support/shellicar-mcp-history`
- **Windows** - `%LOCALAPPDATA%\shellicar-mcp-history`

## Credits & Inspiration

- [Model Context Protocol](https://modelcontextprotocol.io)
- [ctxrs/ctx](https://github.com/ctxrs/ctx)
