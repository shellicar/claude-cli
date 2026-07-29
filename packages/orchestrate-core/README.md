# @shellicar/orchestrate-core

> Tool orchestration used by the claude-cli tools: planning and executing a pipeline of stages, streaming, and named captures.

[![npm package](https://img.shields.io/npm/v/@shellicar/orchestrate-core.svg)](https://npmjs.com/package/@shellicar/orchestrate-core)
[![build status](https://github.com/shellicar/claude-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/shellicar/claude-cli/actions/workflows/ci.yml)

The runtime the Orchestrate tool is built on: stages joined by `|`, `&&` and `;`, one stage's output streamed into the next, batch fan-out via Xargs, and a stage's output captured as a named variable later stages reference.

This is an internal package. It is published as part of [claude-cli](https://github.com/shellicar/claude-cli#readme) but is not intended for standalone use. See the [main documentation](https://github.com/shellicar/claude-cli#readme).
