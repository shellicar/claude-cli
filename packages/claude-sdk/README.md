# @shellicar/claude-sdk

> A minimal, composable SDK for building Claude agents using the Messages API.

[![npm package](https://img.shields.io/npm/v/@shellicar/claude-sdk.svg)](https://npmjs.com/package/@shellicar/claude-sdk)
[![build status](https://github.com/shellicar/claude-cli/actions/workflows/node.js.yml/badge.svg)](https://github.com/shellicar/claude-cli/actions/workflows/node.js.yml)

## Features

- Streaming agent loop over the Messages API
- Typed tool registration and execution pipeline (resolve, validate, approve, execute)
- Bidirectional communication via MessageChannel
- Parallel tool approval: all requests sent at once, resolved independently
- Access to the raw messages array

## Installation

```sh
pnpm add @shellicar/claude-sdk
```

## Quick Start

> TODO: usage example

## Motivation

The official Claude Agent SDK spawns a subprocess. You get text back, but you do not own the loop. You cannot inspect what enters context, capture per-turn token costs, intercept tool calls before they execute, or plug in your own approval logic.

This SDK is not a replacement for the Anthropic SDK. It has a different purpose: run the agent loop in your process and give you direct access to it. No policy, no framework, no enforced workflows. The loop is yours. What you build on top of it is your problem.
