# Claude CLI — Project Instructions

## Convention

This repository uses `shellicar-oss` conventions.

## Milestone

All work is tracking toward the `1.0.0` milestone.

## Pull Requests

Every PR must include:

- **Milestone**: `1.0.0`
- **Reviewer**: `bananabot9000`
- **Assignee**: `shellicar`
- **Label**: one of `bug`, `enhancement`, or `documentation` (pick the most appropriate)
- **Auto-merge**: enable with `gh pr merge --auto --squash`

## Branch Naming

Use the following prefixes:

- `feature/` — new functionality
- `fix/` — bug fixes
- `docs/` — documentation-only changes

## Build

Run `pnpm build` before committing to verify the project compiles.

## System Prompt

The CLI injects a system prompt append before each SDK query. This is built by `SystemPromptBuilder` using modular `SystemPromptProvider` implementations in `src/providers/`. The system prompt should NOT be built or sent for local commands (e.g. `/compact`, `/help`) that don't invoke the SDK.
