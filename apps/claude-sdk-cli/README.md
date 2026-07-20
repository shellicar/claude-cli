# @shellicar/claude-sdk-cli

> A terminal-native alternative to Claude Code that talks to the Messages API directly.

[![npm package](https://img.shields.io/npm/v/@shellicar/claude-sdk-cli.svg)](https://npmjs.com/package/@shellicar/claude-sdk-cli)
[![build status](https://github.com/shellicar/claude-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/shellicar/claude-cli/actions/workflows/ci.yml)

A terminal client for Claude with a small set of composable tools. It talks to the Messages API directly through [`@shellicar/claude-sdk`](https://github.com/shellicar/claude-cli/tree/main/packages/claude-sdk), signs in with your Claude account, and stores sessions as flat JSONL you can script against.

## Installation

```sh
npm i -g @shellicar/claude-sdk-cli
```

```sh
pnpm add -g @shellicar/claude-sdk-cli
```

Then run `claude-sdk-cli`. On first run it opens your browser to sign in.

## Documentation

Full documentation, configuration, and usage live in the [main README](https://github.com/shellicar/claude-cli#readme).
