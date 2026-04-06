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

Refactoring `AppLayout.ts` into focused, testable units (milestone 1.0 prerequisite).

| Step | Status | PR |
|------|--------|----|
| 1a Conversation split | ✅ Done | #183 |
| 1b History replay | ✅ Done | #186 |
| 2 RequestBuilder | ✅ Done | #187 |
| 3a EditorState (fields) | ✅ Done | #189 |
| 3b EditorState.handleKey | ✅ Done | #190 |
| 3c renderEditor | ✅ Done | #191 |
| 4a AgentMessageHandler stateless | ✅ Done | #192 |
| 4b AgentMessageHandler stateful | ✅ Done | #193 |
| 5a StatusState + renderStatus | ✅ Done | #194 |
| 5b ConversationState + renderConversation | ✅ Done | #196 |
| 5c ToolApprovalState + renderToolApproval | ✅ Done | #197 |
| 5d CommandModeState + renderCommandMode | ✅ Done | #198 |
| 5e ScreenCoordinator cleanup | ✅ Done | #199 |

Test count: 338 across 14 spec files. Refactor series complete.

## Recent Decisions

**`PendingTool` moved to `ToolApprovalState.ts`** (step 5c): AppLayout imports ToolApprovalState; keeping PendingTool in AppLayout would create a circular dependency. AppLayout re-exports it so external consumers (AgentMessageHandler) are unaffected.

**`renderToolApproval` returns `{ approvalRow, expandedRows }`**: The two pieces occupy different fixed positions in the layout assembly; `expandedRows.length` is needed for the content-area height calculation before `approvalRow` is placed.

**`#cancelFn` stays in AppLayout**: Agent lifecycle concern, not tool approval state. Extraction deferred to step 5e ScreenCoordinator cleanup.
