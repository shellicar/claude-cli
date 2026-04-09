# Claude CLI — Project Instructions

## Convention

This repository uses `shellicar-oss` conventions.

## Milestone

All work is tracking toward the `1.0.0` milestone.

## Pull Requests

Every PR must include:

- **Milestone**: `1.0`
- **Reviewer**: `bananabot9000`
- **Assignee**: `shellicar`
- **Label**: one of `bug`, `enhancement`, or `documentation` (pick the most appropriate)
- **Package label(s)**: add a `pkg: <name>` label for every package the PR touches. Labels exist for `claude-core`, `claude-sdk`, `claude-sdk-tools`, `claude-sdk-cli`, `claude-cli`. A PR touching all packages gets all five.
- **Auto-merge**: enable with `gh pr merge --auto --squash`

## Changelog

This is a monorepo. Each publishable package has its own release lifecycle:

- **Tags** use the format `<package-name>@<version>` (e.g. `claude-sdk@1.0.0-beta.1`). The package name is the last segment of the npm name — `@shellicar/claude-sdk` → `claude-sdk`.
- Each package has a `changes.jsonl` and a `CHANGELOG.md`.
- **`changes.jsonl`** records individual changes as they land. Add an entry for every PR that touches the package:
  ```jsonl
  {"description":"What changed","category":"feature|fix|breaking|deprecation|security|performance"}
  ```
  `category` is required; valid values come from `changes.config.json`. Do not add issue or PR references at the top level: link backward to issues via `metadata` if needed.

  Release markers look like: `{"type":"release","version":"1.0.0-beta.1","date":"YYYY-MM-DD"}`
- **`CHANGELOG.md`** is updated from `changes.jsonl` entries when cutting a release. The publish workflow validates that the top entry matches the release tag version.
- The **root `CHANGELOG.md`** covers the legacy `claude-cli` app (unscoped tags like `1.0.0-alpha.74`).

## @shellicar/changes Tooling

Schema and validation for `changes.jsonl` files:

- **`changes.config.json`** (repo root): defines valid category keys and their display names.
- **`schema/shellicar-changes.json`**: generated JSON schema artifact. Regenerate with `pnpm tsx scripts/src/generate-schema.ts` (run from `scripts/`).
- **Validate**: `pnpm tsx scripts/src/validate-changes.ts` checks all `**/changes.jsonl` files against the schema. Pass specific filenames as arguments to validate those only. CI runs this step automatically.

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
