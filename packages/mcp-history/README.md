# @shellicar/mcp-history

> Give an LLM a memory of its own past conversations.

[![npm package](https://img.shields.io/npm/v/@shellicar/mcp-history.svg)](https://npmjs.com/package/@shellicar/mcp-history)
[![build status](https://github.com/shellicar/claude-cli/actions/workflows/node.js.yml/badge.svg)](https://github.com/shellicar/claude-cli/actions/workflows/node.js.yml)

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

## Where the store lives

- macOS: `~/Library/Application Support/shellicar-mcp-history`
- Linux: `$XDG_DATA_HOME/shellicar-mcp-history`, or `~/.local/share/shellicar-mcp-history` if `$XDG_DATA_HOME` is unset
- Windows: `%LOCALAPPDATA%\shellicar-mcp-history`

The index lives in `history.db` under that directory.

## Credits & Inspiration

- [Model Context Protocol](https://modelcontextprotocol.io)
