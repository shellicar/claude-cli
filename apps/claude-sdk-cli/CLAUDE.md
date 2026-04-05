# claude-sdk-cli — App Notes

## Overview

`apps/claude-sdk-cli` is the **new** CLI, intentionally lightweight, built on `packages/claude-sdk` (the custom agent SDK). It is the active development target. `apps/claude-cli` is the older CLI built on `@anthropic-ai/claude-agent-sdk` and is kept as a reference.

The distinction matters: `claude-sdk-cli` owns the agentic loop directly — `AgentRun.execute()`, `MessageStream`, `ConversationHistory`, cache control, cost calculation. The Anthropic SDK is just an HTTP client. This is what makes cost tracking, context management, orchestration, and observability possible.

## Design Principles

- **Lightweight by design** — no session management, no built-in permissions, no built-in tools (tools live in `packages/claude-sdk-tools`)
- **Own the loop** — full control over the message cycle, caching, token tracking
- **Explicit over magic** — tool results, refs, approvals are all visible and deliberate

## Planned Features

### Command Mode (not yet implemented)
Ctrl+/ enters command mode, single-key commands inside (like roguelikes/Dwarf Fortress).
Ref: see `apps/claude-cli/src/CommandMode.ts` for the existing implementation to port.

Planned bindings:
- `i` — paste image from clipboard
- `t` — paste text as attachment (large text block, labelled, not inline)
- More TBD

### Attachments / Paste (not yet implemented)
Ref: `apps/claude-cli/src/AttachmentStore.ts`, `apps/claude-cli/src/clipboard.ts`, `apps/claude-cli/src/ImageStore.ts`.

`runAgent.ts` currently passes `messages: [prompt]` — needs to become `messages: [...attachments, prompt]`.

Note: direct terminal paste is extremely slow for large content. Clipboard read via command mode is the correct approach.

### Input
The current input method (readline) is slow for large pastes. Needs investigation — may require a different approach for the alt buffer.

---

## Tool Result Size & Context Protection

This is the most urgent infrastructure gap. Without it, a single `ReadFile` on a large file can exhaust the entire context and cause an API error.

### The Problem

Currently all tool results go directly into the conversation with no size limit. The official `@anthropic-ai/claude-agent-sdk` handles this by redirecting large outputs to a temp file and returning the path instead — but this is a blunt instrument (the whole result is replaced, losing structured fields like `exitCode`).

### The Four Layers (distinct problems, distinct owners)

**1. Ref-swapping large output** *(most urgent — serialisation layer)*

One intervention point, before the tool result enters the conversation. Walk the JSON tree, find string fields over a threshold (e.g. 10k chars), swap them with `{ ref: 'uuid', size: N }`. The tool itself doesn't need to change at all.

Example — without ref-swapping:
```json
{ "exitCode": 0, "stdout": "...500kb of build output..." }
```
With ref-swapping:
```json
{ "exitCode": 0, "stdout": { "ref": "abc123", "size": 512000 } }
```
The model still sees `exitCode`, still knows stdout was large, can choose to query the ref or not.

**2. Ref store / query tool** *(prerequisite for #1)*

Every tool result gets stored, regardless of size (write-always). A `Ref` tool lets the model retrieve stored content with optional paging/slicing. The EditFile patch store is the same pattern — just global scope.

Tool probably looks like:
```
Ref(id, offset?, length?) → { content: string, size: N, truncated: bool }
```

**3. Culling old tool results from history** *(history / message loop)*

After N turns, old tool results get summarised or dropped from `ConversationHistory`. Owned by the message loop, not the tools. Less urgent than #1 and #2.

**4. Context search / RAG** *(separate problem entirely)*

If context becomes unwieldy, semantic search over it. Different infrastructure, different owner. Lowest priority.

### Implementation Order
1. Ref store (simple in-memory store, keyed by UUID)
2. Ref-swapping at the serialisation layer (walk JSON, swap large strings)
3. `Ref` query tool
4. Culling policy in `ConversationHistory`
5. RAG (future, separate concern)

### Design Note on Ref Store
The ref store uses `hash(prev.newContent)` style per-step hashing (not inherited root hash) — i.e. each ref is self-contained. Unlike the EditFile patch chain where `originalHash` is inherited from the root, refs don't need to chain.

---

## Token / Cost Display

Status line format (implemented):
```
in: 7  ↑138.0k  ↓65.7k  out: 610  $0.5465  ctx: 72.3k/200.0k (36.1%)
```
- `in:` — uncached input tokens (small when cache is hot)
- `↑` — cache creation tokens (written, expensive)
- `↓` — cache read tokens (read, cheap) — shown only when > 0
- `out:` — output tokens
- `$` — total cost this turn (cumulative across turns)
- `ctx:` — per-turn context usage vs model context window

Previous bug: `↑` (cache creation) was invisible in the display but was included in cost, making the cost appear wildly wrong (e.g. `in: 3  $5.21`).

---

## Key Files

| File | Role |
|------|------|
| `src/entry/main.ts` | Entry point |
| `src/AppLayout.ts` | TUI layout, streaming, tool display, status line |
| `src/runAgent.ts` | Agent loop wiring — tools, approval, message dispatch |
| `src/ReadLine.ts` | Terminal input |
| `src/permissions.ts` | Tool auto-approve/deny rules |
| `src/logger.ts` | Structured logging with truncation |
| `src/redact.ts` | Redaction for audit/log output |
