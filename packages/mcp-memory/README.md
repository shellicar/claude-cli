# @shellicar/mcp-memory

> An MCP server exposing a persistent memory store: write, search, read, and delete memories, backed by SQLite FTS5.

## Features

- 🧠 **Five tools** - `WriteMemory`, `ReadMemory`, `SearchMemory`, `DeleteMemory`, `MemoryTypes`.
- 🔎 **Relevance search** - full-text search ranked by bm25, optionally narrowed to one type.
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

## Storage

Memories live in a SQLite file, `memory.db`, under the platform's standard data directory for `shellicar-mcp-memory`. `$XDG_DATA_HOME`, if set, wins on every platform, not just Linux:

- **`$XDG_DATA_HOME` set** - `$XDG_DATA_HOME/shellicar-mcp-memory`
- **Linux** - `~/.local/share/shellicar-mcp-memory`
- **macOS** - `~/Library/Application Support/shellicar-mcp-memory`
- **Windows** - `%LOCALAPPDATA%\shellicar-mcp-memory`

Each memory is stamped with the git remote of the working directory it was written from, when available, so a search hit can announce where it came from.

## Credits & Inspiration

- [Model Context Protocol](https://modelcontextprotocol.io)
