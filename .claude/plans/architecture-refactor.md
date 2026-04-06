# Architecture Refactor Plan

## Context

Identified 2026-04-06. The SDK and CLI work correctly but several classes carry more
responsibilities than they should, which makes them harder to extend and impossible to
unit test in isolation. This plan captures the agreed design direction and the ordered
steps to get there.

The core invariant: **the CLI+SDK must work at every commit**. Each substep is a
complete, shippable unit. If a substep goes wrong, revert it — all previous substeps
remain intact. Nothing is abandoned; rollback cost is always exactly one step.

---

## Target Design

### SDK

| Class | Responsibility |
|-------|---------------|
| `Conversation` | Pure data: ordered messages, role alternation, compaction trim. No I/O. |
| `ConversationStore` | Load/save a `Conversation` from a JSONL file. |
| `RequestBuilder` | Pure function: `(RunAgentQuery, messages) → BetaMessageStreamParams`. |
| `StreamProcessor` | Raw Anthropic stream events → typed blocks. Already `MessageStream`, keep as-is. |
| `ToolRunner` | Validate input, call handler, transform result. |
| `AgentLoop` | Orchestrate: Conversation + RequestBuilder + StreamProcessor + ToolRunner. The loop itself. |

Auth is already well-decomposed. No changes planned there.

### CLI

| Class | Responsibility |
|-------|---------------|
| `TerminalEditor` | Multi-line text input, cursor, word navigation. No rendering, no stream knowledge. |
| `ConversationDisplay` | Sealed block system, streaming display, flush-to-scroll. |
| `ToolApprovalWidget` | Pending tools list, keyboard-driven approval, async promise. |
| `StatusBar` | Running token/cost totals. Renders to a single line. |
| `CommandMode` | `/` command handling, clipboard, attachments. |
| `ScreenCoordinator` | Owns the physical screen. Routes keyboard events. Assembles render output. (Slimmed `AppLayout`.) |
| `AgentMessageHandler` | Maps `SdkMessage` events → display component calls. Extracted from `runAgent.ts`. |
| `PermissionPolicy` | Auto-approve/deny logic. Currently split across `permissions.ts` and `runAgent.ts`. |

---

## Steps

### Prerequisite: Test framework
Set up vitest in the monorepo (workspace config, turbo pipeline, per-package config).
**Estimate: 1 — do this alongside step 1a.**

---

### Step 1 — Split `Conversation` from `ConversationStore`

**1a — Extract `Conversation` (pure data)**
- `Conversation`: holds `#items`, `push()`, `remove()`, `messages` getter, role-alternation,
  compaction trim. No file I/O.
- `ConversationStore`: wraps `Conversation`, loads from JSONL in constructor, calls save on
  every mutation.
- `AgentRun` receives `Conversation` instead of `ConversationHistory`.
- External API unchanged (`historyFile` option still works).
- **Estimate: 1 | Risk: Low** — single failure mode: forgetting to call save in
  `ConversationStore.push()`. Obvious, fast to catch.
- **Tests: `Conversation` becomes fully unit-testable** — role alternation, compaction clear,
  push/remove, trim logic. All pure assertions, no mocks needed. +1 for tests.

**1b — History replay in TUI**
- On startup, walk the messages loaded from file and replay them into `ConversationDisplay`
  so prior turns are visible.
- Requires decisions: what to show for compaction blocks, tool use/result pairs, thinking
  blocks. Get this wrong → confusing display, not a crash.
- Depends on 1a (cleanly) but is a separate commit.
- **Estimate: 2 | Risk: Medium** — decisions about what to display, runtime-visible.
- **Tests: partial** — the parse-to-display-events function is testable if extracted. +1.

---

### Step 2 — Extract `RequestBuilder`

- Extract `AgentRun.#getMessageStream` params-building into a pure function/class:
  tools mapping, betas resolution, context_management config, system prompts, cache_control,
  thinking flag → `BetaMessageStreamParams`.
- `#getMessageStream` keeps the stream call, delegates params to `RequestBuilder`.
- No UI impact, no external API change.
- **Estimate: 1 | Risk: Very Low** — TypeScript catches missed fields. API error on first
  run if anything wrong. Fast to diagnose.
- **Tests: clean** — one test per beta feature: "given compact enabled, request has compact
  edit". Pure assertions. +1 for tests.

---

### Step 3 — Extract `TerminalEditor` from `AppLayout`

Do these in order. Each substep compiles and runs standalone.

**3a — Extract editor state**
- Move `#editorLines`, `#cursorLine`, `#cursorCol` to `TerminalEditor`.
- Expose accessors. `AppLayout` holds `this.#editor` and reads state from it.
- Key handling and rendering stay in `AppLayout` for now.
- **Estimate: 1 | Risk: Low** — TypeScript finds every missed reference at compile time.
- **Tests: marginal at this point** — state is there but key handling isn't yet.

**3b — Move key handling into `TerminalEditor.handleKey()`**
- `AppLayout.handleKey` routes: if editor mode → `this.#editor.handleKey(key)`.
- Must be done atomically — extract AND update call site in same commit. No gap where
  neither has the logic.
- Edge cases: backspace at col 0 merges lines, Enter mid-line splits, multi-line paste,
  word jump at line boundary. These are where regressions hide.
- **Estimate: 2 | Risk: Medium-High** — runtime edge case regressions, caught by typing.
- **Tests: clean and valuable** — pure state machine. Test every edge case: backspace at
  line start, Enter mid-line, Ctrl+Left, paste. High confidence. +2 for tests.

**3c — Move editor rendering into `TerminalEditor.render(cols)`**
- `AppLayout.render()` calls `this.#editor.render(cols)` for the editor region.
- Visual regression if column width or ANSI cursor placement is wrong — visible immediately.
- **Estimate: 1 | Risk: Medium** — fast feedback, obvious if wrong.
- **Tests: partial** — render string for known input is assertable; ANSI codes noisy. +1.

---

### Step 4 — Extract `AgentMessageHandler` from `runAgent.ts`

**4a — Stateless cases**
- Move `message_thinking`, `message_text`, `message_compaction_start`, `message_compaction`,
  `done`, `error`, `query_summary` into `AgentMessageHandler`.
- Constructor takes `layout`, `logger`, model, cacheTtl.
- `port.on('message', (msg) => handler.handle(msg))`.
- **Estimate: 1 | Risk: Low** — straight delegations, TypeScript catches missing refs.
- **Tests: clean** — mock layout components, assert right methods called for each message. +1.

**4b — Stateful cases**
- Move `usageBeforeTools` tracking and delta calculation.
- Move `toolApprovalRequest` async function.
- The invariant: capture usage at start of first tool batch, compute delta on next
  `message_usage`, then null. Getting the reset timing wrong → wrong delta annotation.
  Not a crash, but a wrong number on the tools block.
- **Estimate: 1-2 | Risk: Medium** — runtime-visible wrong number, needs a tool-use
  interaction to catch.
- **Tests: clean** — fire a sequence of tool+usage messages, assert delta annotation
  string. Catches the reset-timing bug. +1.

---

### Step 5 — Split display components out of `AppLayout`

**5a — Extract `StatusBar`**
- Move the 5 token/cost accumulators and the status line render logic.
- `AppLayout` holds `this.#statusBar`, calls `updateUsage` and `render`.
- **Estimate: 1 | Risk: Low** — pure state + string render. Visible immediately if wrong.
- **Tests: clean** — given usage sequence, assert totals and rendered string. +1.

**5b — Extract `ConversationDisplay`**
- Move sealed blocks, active block, flush count, `transitionBlock`, `appendStreaming`,
  `completeStreaming`, `appendToLastSealed`, render logic.
- The flush-to-scroll boundary is subtle — blocks flushed to scroll are permanently written.
  Getting `#flushedCount` wrong causes double-rendering or missing content.
- **Estimate: 2 | Risk: Medium** — flush logic is the dangerous part, visible but confusing.
- **Tests: partial** — state logic yes; flush-to-scroll needs mock screen infrastructure. +1-2.

**5c — Extract `ToolApprovalWidget`**
- Move pending tools list, selection, expand/collapse, keyboard handler, approval promise
  queue (`#pendingApprovals`).
- The async coordination — resolve functions in an array, keyboard handler pops them —
  must move together. Splitting this across two commits creates a broken state.
- **Estimate: 2 | Risk: Medium-High** — async approval flow, only caught during a
  tool-use interaction.
- **Tests: valuable** — async approval flow, cancel flow, keyboard navigation. +2.

**5d — `ScreenCoordinator` cleanup**
- By this point all logic has moved out. `AppLayout` becomes wiring + keyboard routing +
  render assembly.
- **Estimate: 1 | Risk: Low** — routing logic, visible immediately if wrong.
- **Tests: marginal** — routing logic testable; screen output not. —

---

## Summary

| Step | Estimate | Risk | Tests (additional) |
|------|----------|------|-------------------|
| Prereq: vitest setup | 1 | Low | — |
| 1a Conversation split | 1 | Low | +1 |
| 1b History replay | 2 | Medium | +1 |
| 2 RequestBuilder | 1 | Very Low | +1 |
| 3a Editor state | 1 | Low | — |
| 3b Editor key handling | 2 | Medium-High | +2 |
| 3c Editor rendering | 1 | Medium | +1 |
| 4a MessageHandler stateless | 1 | Low | +1 |
| 4b MessageHandler stateful | 1-2 | Medium | +1 |
| 5a StatusBar | 1 | Low | +1 |
| 5b ConversationDisplay | 2 | Medium | +1-2 |
| 5c ToolApprovalWidget | 2 | Medium-High | +2 |
| 5d ScreenCoordinator cleanup | 1 | Low | — |
| **Total** | **17-19** | | **+12-13** |

Refactoring alone: ~17-19 units. With tests written at each step: ~29-32 units.

The steps with the best test ROI (high value, catches real bugs): **1a, 2, 3b, 4b**.
Start there. The rest can follow.
