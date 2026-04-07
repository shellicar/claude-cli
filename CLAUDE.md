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

Run `pnpm type-check` and `pnpm build` before committing to verify types and compilation.

## System Prompt

The CLI injects a system prompt append before each SDK query. This is built by `SystemPromptBuilder` using modular `SystemPromptProvider` implementations in `src/providers/`. The system prompt should NOT be built or sent for local commands (e.g. `/compact`, `/help`) that don't invoke the SDK.

## Current State

Refactor series complete (steps 1a–5e, PRs #183–#199). Test count: 338 across 14 spec files.

Active feature work:

| PR | Branch | Description |
|----|--------|-------------|
| #206 | `fix/preview-edit-line-text-split` | Split PreviewEdit `edits` into `lineEdits` + `textEdits` |
| #207 | `feature/cache-ttl-enum` | Move `CacheTtl` to enums, export from package, raise `maxTokens` |
| #211 | `docs/sdk-tools-and-cli-feature-backlog` | Add sdk-tools and CLI feature backlog plans |

Backlog plans in `.claude/plans/`: `sdk-tools.md` (issues #208–#210, #177, #178), `cli-features.md` (issues #94, #96, #97, #101, #104, #105, #128, #130, #164, #179).

## Recent Decisions

**`PreviewEdit` uses `lineEdits` + `textEdits` instead of flat `edits` array** (PR #206): Separating structural edits (by line number, applied bottom-to-top) from text-search edits (applied in order after all line edits) eliminates semantic ambiguity. Previously a mixed `edits` array required tracking offset drift across line and text edits interleaved. The split makes ordering rules unambiguous and the schema self-documenting.

**`CacheTtl` moved to `enums.ts` alongside `AnthropicBeta`** (PR #207): Was only in `types.ts` as a type-level const; moving it makes it importable as a value by consumers. `maxTokens` raised from 8000 to 32000 to match the model's actual capability.

**`PendingTool` moved to `ToolApprovalState.ts`** (step 5c): AppLayout imports ToolApprovalState; keeping PendingTool in AppLayout would create a circular dependency. AppLayout re-exports it so external consumers (AgentMessageHandler) are unaffected.

**`renderToolApproval` returns `{ approvalRow, expandedRows }`**: The two pieces occupy different fixed positions in the layout assembly; `expandedRows.length` is needed for the content-area height calculation before `approvalRow` is placed.
