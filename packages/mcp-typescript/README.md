# @shellicar/mcp-typescript

> MCP server exposing TypeScript language intelligence (diagnostics, hover, references, definitions) via a real `tsserver`.

[![npm package](https://img.shields.io/npm/v/@shellicar/mcp-typescript.svg)](https://npmjs.com/package/@shellicar/mcp-typescript)
[![build status](https://github.com/shellicar/claude-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/shellicar/claude-cli/actions/workflows/ci.yml)

## Features

- 🩺 **Type errors without a build** - Get syntactic and semantic diagnostics for one or more files in a single call, no `tsc` run required.
- 🔍 **Symbol info at a position** - Get the type signature, kind, and JSDoc for whatever's at a given line/character.
- 🔗 **Find every usage** - Get every reference to a symbol across the project from one position, grouped by file.
- 🎯 **Jump to definition** - Resolve a symbol at a position to where it's actually defined, including overloads and declaration merging.
- 🔌 **stdio transport** - Drop it into any MCP client that speaks stdio.

## Installation & Quick Start

```sh
npm i -g @shellicar/mcp-typescript
```

```sh
pnpm add -g @shellicar/mcp-typescript
```

It runs as a stdio MCP server under the `mcp-typescript` command. Point your MCP client at it:

```json
{
  "mcpServers": {
    "typescript": {
      "command": "mcp-typescript"
    }
  }
}
```

## Motivation

Without this, an agent answers "where is this defined" or "what's wrong with this file" by grepping and reading source across the repo and its `node_modules`, several exploratory tool calls per question, and still just guessing at what a real type checker would tell it directly. This wraps an actual `tsserver` process behind four tools, so the agent gets a precise answer in one call instead of reconstructing it from text search.

Other MCP wrappers around `tsserver` I tried left the process running indefinitely, accumulating as zombies across sessions. This one scopes a fresh `tsserver` to each tool call and tears it down again once that call finishes, so nothing outlives the request that needed it.

## Credits & Inspiration

- [Model Context Protocol](https://modelcontextprotocol.io)
