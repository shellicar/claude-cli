# @shellicar/mcp-exec

> An MCP server that runs commands through a structured schema, wrapping the Exec tool from @shellicar/claude-sdk-tools.

[![npm package](https://img.shields.io/npm/v/@shellicar/mcp-exec.svg)](https://npmjs.com/package/@shellicar/mcp-exec)
[![build status](https://github.com/shellicar/claude-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/shellicar/claude-cli/actions/workflows/ci.yml)

## Features

- ⚙️ **One tool, `exec`** - Run commands through a typed schema instead of a shell string.
- 🔗 **Pipelines and chaining** - Sequence commands, stop on the first failure, or pipe one into the next.
- 🔌 **stdio transport** - Drop it into any MCP client that speaks stdio.

## Installation & Quick Start

```sh
npm i -g @shellicar/mcp-exec
```

```sh
pnpm add -g @shellicar/mcp-exec
```

It runs as a stdio MCP server under the `mcp-exec` command. Point your MCP client at it:

```json
{
  "mcpServers": {
    "exec": {
      "command": "mcp-exec"
    }
  }
}
```

## Motivation

Running a command through a shell string invites quoting bugs and injection. This package exposes a structured Exec tool to any MCP client, so an agent runs commands through a typed schema instead.

## The exec tool

The tool takes an intent, a list of steps, and a chaining mode. Each step holds one or more commands; a single command runs on its own, and two or more form a pipeline (one command's output feeds the next).

```json
{
  "intent": "List a directory in long form",
  "steps": [
    {
      "commands": [
        {
          "program": "ls",
          "args": [
            "-la"
          ],
          "cwd": "/path/to/dir"
        }
      ]
    }
  ]
}
```

Each command takes a `program`, its `args` as separate strings, and optionally a `cwd`, `env`, and `stdin`. No shell quoting or escaping is needed, because nothing goes through a shell.

The `chaining` mode controls how steps relate:

- `bail_on_error` (default) - run steps in order, stop at the first failure
- `sequential` - run every step in order
- `independent` - run every step and report each result

## Credits & Inspiration

- [Model Context Protocol](https://modelcontextprotocol.io)
