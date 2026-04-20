# Fix: server tool blocks dropped from conversation history

## Status: ready

## Branch

Create branch `fix/server-tool-blocks-in-history` from `main`.

## Problem

When the API returns an assistant message containing server tool blocks (`server_tool_use`, `web_search_tool_result`, etc.), the `StreamProcessor` emits display events for them but does not include them in the `completed` blocks array. The `TurnRunner` builds the assistant message pushed into `Conversation` from that array. The result: the stored assistant message is missing blocks that the API returned.

When the next turn sends this stripped message back to the API, the API rejects it with:

```
messages.9.content.3: `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the original response.
```

The API requires the latest assistant message to be sent back with its full content array intact. Removing blocks (even non-thinking ones) constitutes modification.

### What gets dropped

The `ContentBlock` union in `types.ts` only covers `thinking | text | tool_use | compaction`. The `StreamProcessor` accumulates server tool blocks in its accumulator but on `content_block_stop` only emits events for them, never pushes to `completed`. Specifically:

1. `server_tool_use` blocks: accumulated, emitted via event, not pushed to completed
2. `web_search_tool_result` / `web_fetch_tool_result` / all server tool result types: accumulated, emitted via event, not pushed to completed
3. `redacted_thinking` blocks: ignored entirely at `content_block_start` (just `break`)
4. `citations` on text blocks: `citations_delta` events are silently dropped, text accumulator has no citations field

The `TurnRunner.mapBlock` function only handles `text | thinking | tool_use | compaction`, matching the `ContentBlock` union.

### What works correctly

The `AuditWriter` receives the full `BetaMessage` via the Anthropic SDK's `finalMessage` event on the stream, which preserves the complete content array. The audit log has the correct data. The conversation file does not.

### The exact sequence

The API returned an assistant message with 47 content blocks (from the audit log):

```
[0]  thinking
[1]  text
[2]  server_tool_use      (web_search)
[3]  server_tool_use      (web_search)
[4]  web_search_tool_result
[5]  web_search_tool_result
[6]  server_tool_use      (web_search)
[7]  server_tool_use      (web_search)
[8]  web_search_tool_result
[9]  web_search_tool_result
[10] thinking
[11] server_tool_use      (web_search)
[12] web_search_tool_result
[13] thinking
[14] text
[15] text (with citations)
[16] text
[17] text (with citations)
... more text blocks, some with citations, through [46]
```

The conversation file stored only 37 blocks:

```
[0]  thinking
[1]  text
[2]  thinking             (was at [10] in original)
[3]  thinking             (was at [13] in original)
[4]  text
[5]  text (no citations)  (had citations in original)
... more text blocks, all without citations, through [36]
```

Dropped entirely: all `server_tool_use` blocks (5), all `web_search_tool_result` blocks (5).
Stripped from text blocks: `citations` arrays.

The API error pointed at `messages.9.content.3`, which in the stripped message is a thinking block that was originally at a different position in a different content array. The API detected the message was modified and rejected it.

## Approach

This is a stop-gap fix. The proper fix (separating display processing from conversation state, using `finalMessage` for the conversation) is a larger architectural change for later. This fix adds the missing block types to the existing processing path.

### Files to change

- `packages/claude-sdk/src/private/types.ts`: expand `ContentBlock` union
- `packages/claude-sdk/src/private/StreamProcessor.ts`: push server tool blocks and redacted_thinking to `completed` (alongside existing event emission)
- `packages/claude-sdk/src/private/TurnRunner.ts`: expand `mapBlock` to handle new block types

### What NOT to change

- Do not change the display event emission. The `server_tool_use` and `server_tool_result` events must continue to fire as before.
- Do not change `Conversation.ts`, `QueryRunner.ts`, or `ConversationSession.ts`.
- Do not change the `AnthropicClient` or `AuditWriter`.

## Phase 1: Red

Write tests that expose the bug. These tests go in the existing test files.

### StreamProcessor tests (`packages/claude-sdk/test/StreamProcessor.spec.ts`)

The existing test `'does not push server_tool_use or web_fetch_tool_result blocks to completed'` asserts the broken behavior. It needs to be changed to assert the opposite: that these blocks ARE included in `completed`.

Write a new describe block for the conversation-integrity scenario. The test should construct a stream that mirrors what the API returns for a web-search response:

1. `thinking` block (content_block_start with type thinking, thinking_delta events, signature_delta, content_block_stop)
2. `text` block
3. `server_tool_use` block (web_search)
4. `web_search_tool_result` block
5. Another `thinking` block
6. `text` block

Process the stream and assert that `result.blocks` contains ALL six blocks in order, not just the thinking and text blocks.

Also write a test for `redacted_thinking`: a stream with a `redacted_thinking` content_block_start should produce a block in `completed`.

### TurnRunner tests (`packages/claude-sdk/test/TurnRunner.spec.ts`)

Write a test that processes a stream containing server tool blocks and asserts that the assistant message pushed into the `Conversation` includes those blocks. Use the existing `FakeMessageStreamer` pattern. The conversation's last assistant message content array should contain `server_tool_use` and `web_search_tool_result` type blocks.

### Verify red

Run `pnpm --filter @shellicar/claude-sdk test` and confirm the new tests fail. The existing test that asserts blocks are excluded will also need updating, so it should fail in its current form once you change the assertion.

## Phase 2: Green

### `types.ts`

Expand the `ContentBlock` union to include the new block types. The shapes should carry enough data to reconstruct the wire-format blocks. For server tool blocks, store the full content_block as received from the stream event (the `content_block_start` event carries the complete block for result types, and id/name/input for use types). For `redacted_thinking`, store the `data` field.

### `StreamProcessor.ts`

In the `content_block_stop` handler:

- For `server_tool_use`: push to `completed` in addition to emitting the event. The block needs `type`, `id`, `name`, and the parsed `input` from `partialJson`.
- For `server_tool_result`: push to `completed` in addition to emitting the event. Store the original `content_block` from `content_block_start` since the result block carries the full structure.
- For `redacted_thinking`: handle it at `content_block_start` (currently just `break`). Accumulate the block and push to `completed` on stop. The wire format is `{ type: 'redacted_thinking', data: string }`.

For citations on text blocks: the `citations_delta` handler currently does nothing. For this fix, citations can be left as-is. The text content itself is preserved, and the API's validation appears to focus on thinking block integrity rather than citation presence. If this turns out to be wrong, citations can be added in a follow-up.

### `TurnRunner.ts`

Expand `mapBlock` to handle the new `ContentBlock` variants. For server tool blocks and redacted_thinking, map them to the appropriate `BetaContentBlockParam` types. Since these are pass-through blocks (the SDK doesn't need to interpret them, just preserve them), the mapping should be straightforward: reconstruct the wire-format block from the stored fields.

### Verify green

Run `pnpm --filter @shellicar/claude-sdk test` and confirm all tests pass.

## Supervisor Verification

## Delivery Notes

## Post-Mortem
