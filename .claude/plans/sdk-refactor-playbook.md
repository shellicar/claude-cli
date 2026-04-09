# SDK refactor playbook

## What this document is

This is the execution companion to `.claude/plans/sdk-shape.md`. The plan describes WHAT the SDK should be after the refactor. The playbook describes HOW to get there: which files are involved for each block, what happens to each, and in what order.

If this playbook and the plan disagree about the end state, the plan wins and the playbook is fixed. The plan is authoritative for design; the playbook is authoritative for execution order.

## Phases

The refactor runs in three phases:

**Phase 1: Plan (done).** The design document at `.claude/plans/sdk-shape.md` is settled.

**Phase 2: Design implementation.** Create new class files alongside the existing code. Write the new `TurnRunner`, `QueryRunner`, `StreamProcessor`, `ToolRegistry`, plus their interfaces. Wire up the new dependency graph and get it compiling. Do not touch the CLI startup path. Do not delete any existing files. The existing code path keeps working unchanged throughout phase 2.

**Phase 3: Swap and cleanup.** Wire the new classes into the CLI startup path. Delete `AgentRun`, `AnthropicAgent`, `createAnthropicAgent`, `ConversationStore`, `MessageStream`, `IAnthropicAgent`, `RunAgentQuery`. Update tests. Phase 3 runs in a later session, after phase 2 is complete and reviewable.

Each file entry below is tagged with the phase(s) it touches.

## File map

### Client

- **`packages/claude-sdk/src/private/AnthropicClient.ts`** `[phase 2: minor]` Update JSDoc to remove the `#232` issue reference (point at the plan file instead). Add a line noting the Client owns client-identifying headers (User-Agent, SDK version) but not feature beta headers.
- **`packages/claude-sdk/src/private/http/TokenRefreshingAnthropic.ts`** `[keep]` Token refresh mechanism. Unchanged.
- **`packages/claude-sdk/src/private/http/customFetch.ts`** `[keep]`
- **`packages/claude-sdk/src/private/http/getBody.ts`** `[keep]`
- **`packages/claude-sdk/src/private/http/getHeaders.ts`** `[keep]`
- **`packages/claude-sdk/src/private/http/sdkInternals.ts`** `[keep]`
- **`packages/claude-sdk/src/private/Auth/*`** (20 files) `[keep]` `[phase 3: optional move]` OAuth flow and credential storage. Behaviour unchanged. Optional phase 3 move to `private/Client/Auth/` to make the Client block's scope visible in the filesystem. Style call; decide before phase 3.

### Conversation

- **`packages/claude-sdk/src/private/Conversation.ts`** `[phase 2: minor]` `[phase 3: delete load]` Phase 2 may add a `setHistory(msgs[])` operation to cleanly support the restore flow from a saved message list (exact shape is an implementation detail; see the plan's "Setting up the SDK" section). Phase 3 deletes the `load()` method, which becomes dead code once `ConversationStore` is deleted.
- **`packages/claude-sdk/src/private/ConversationStore.ts`** `[phase 3: delete]` The whole file goes away. Its only job (wrapping `historyFile` and calling `Conversation.load()`) is removed under the plan rule that the SDK does not touch the filesystem for conversation data.
- **`packages/claude-sdk/test/Conversation.spec.ts`** `[phase 3: trim]` Remove the three `load()` test call sites at lines 219, 228, 236. Other tests stay.

### Stream processor

- **`packages/claude-sdk/src/private/MessageStream.ts`** `[keep, phase 2]` `[phase 3: delete]` The current per-stream class. Kept untouched in phase 2 so the existing code path keeps working. Deleted in phase 3 after the new `StreamProcessor` is wired into the CLI.
- **`packages/claude-sdk/src/private/StreamProcessor.ts`** `[new, phase 2]` New long-lived stream processor class. Same `.on(...)` event names as the current `MessageStream` (`message_start`, `message_text`, `thinking_text`, `message_stop`, `compaction_start`, `compaction_complete`). Constructor takes no per-stream arguments. Method `process(rawIterable)` runs one stream to completion; per-stream state lives in method-local variables, not on the instance. The consumer subscribes once at setup and the handlers fire for every stream the processor handles.
- **`packages/claude-sdk/test/MessageStream.spec.ts`** `[phase 3]` Either rename to `StreamProcessor.spec.ts` and retarget, or leave and write a parallel `StreamProcessor.spec.ts` in phase 2 then delete the old one in phase 3.

### Request builder

- **`packages/claude-sdk/src/private/RequestBuilder.ts`** `[keep]` Pure function, already correct shape. Minor JSDoc update optional to spell out the `systemReminder` cache-boundary placement for the next reader, but not required.
- **`packages/claude-sdk/test/RequestBuilder.spec.ts`** `[keep]`

### Tool registry

There is no existing `ToolRegistry` class. Tool execution currently lives inline in `AgentRun.#executeTool` at `AgentRun.ts:250`.

- **`packages/claude-sdk/src/private/ToolRegistry.ts`** `[new, phase 2]` New class. Constructor takes `AnyToolDefinition[]`, converts Zod schemas to JSON Schema once and caches the result. Method `execute(toolName, input, transformHook?)` validates input against the Zod schema, calls the handler, applies the transform hook if supplied, converts the output to an array of API content blocks, and returns the content blocks. Does NOT construct the full `tool_result` block; that requires knowing the `tool_use_id`, which is the query runner's concern.
- **`packages/claude-sdk/src/public/defineTool.ts`** `[keep]`
- **`packages/claude-sdk/src/public/types.ts`** `[phase 3: minor]` `ToolDefinition` and `AnyToolDefinition` types are unchanged in shape. `RunAgentQuery` is deleted in phase 3. `AnthropicAgentOptions.historyFile` is deleted in phase 3.
- **`packages/claude-sdk/src/public/interfaces.ts`** `[phase 2: add]` Add an `IToolRegistry` abstract class if the plan's behavioural-interface principle is applied here.

### Approval coordinator

- **`packages/claude-sdk/src/private/ApprovalState.ts`** `[keep]` `[phase 3: possible rename]` Already exists. Implements the approval coordinator responsibility: correlates requests with responses by id, parks pending promises, propagates cancel. Possibly rename file and class to `ApprovalCoordinator` in phase 3 to match the plan's naming. Behaviour unchanged.

### Turn runner

There is no existing `TurnRunner`. Turn logic currently lives inline in `AgentRun.run()` around the while loop.

- **`packages/claude-sdk/src/private/TurnRunner.ts`** `[new, phase 2]` New class. Constructor takes dependencies: `IAnthropicClient`, `StreamProcessor`, the request builder function (or the function's import reference). Method `run(conversation, durableConfig, perTurnInput)` executes one turn: reads the Conversation wire view, calls `buildRequestParams`, merges the per-query abort signal into request options, calls the Client to stream the request, hands the iterable to the Stream processor, reads the assembled message when the stream ends, pushes it to the Conversation, returns `{ message, stopReason }`. Does not dispatch tools; that is the query runner's job. Does not subscribe to any events per turn; the consumer's `.on(...)` handlers on the Stream processor are already set up at SDK startup and fire naturally.
- **`packages/claude-sdk/src/public/interfaces.ts`** `[phase 2: add]` Add an `ITurnRunner` abstract class.

### Query runner

There is no existing `QueryRunner`. Query loop logic currently lives in `AgentRun.run()`.

- **`packages/claude-sdk/src/private/QueryRunner.ts`** `[new, phase 2]` New class. Constructor takes dependencies: `TurnRunner`, `Conversation`, `ToolRegistry`, `ApprovalState` (the approval coordinator), durable config. Method `run(perQueryInput)` takes the per-query input fields (user message, optional `systemReminder`, optional `transformToolResult` hook, abort controller). Pushes the user message into the Conversation. Enters the turn loop. For each iteration: calls `turnRunner.run(...)`, inspects the returned stop reason, and if it is `tool_use`, dispatches each `tool_use` block: requests approval via the approval coordinator if required, calls `toolRegistry.execute(name, input, transformHook)` to get content blocks, wraps them in a `tool_result` block with the matching `tool_use_id`, assembles a user-role message carrying the tool_result blocks, pushes it into the Conversation, loops back to the next turn. Exits on terminal stop reason or cancel. Returns (or resolves a promise) when the query is done. Tracks first-turn-only state for `systemReminder`: passes it to `turnRunner.run` on the first iteration, `undefined` on subsequent iterations.
- **`packages/claude-sdk/src/public/interfaces.ts`** `[phase 2: add]` Add an `IQueryRunner` abstract class.

### Control channel

- **`packages/claude-sdk/src/private/AgentChannel.ts`** `[keep]` `[phase 3: possible rename]` Already exists. Wraps a `MessagePort` pair, provides `send` and inbound message dispatch. Possibly rename to `ControlChannel.ts` in phase 3 to match the plan's naming. Behaviour unchanged.

### Files on the CLI side (not SDK blocks, but touched by the refactor)

- **`apps/claude-sdk-cli/src/entry/main.ts`** `[phase 3]` Currently calls `createAnthropicAgent({ authToken, logger, historyFile })` at line 90-ish. Phase 3 replaces this with individual block construction: Client, Conversation, ToolRegistry, ControlChannel (AgentChannel), ApprovalState, StreamProcessor (with `.on(...)` subscriptions set at this point), TurnRunner, QueryRunner, durable config object.
- **`apps/claude-sdk-cli/src/runAgent.ts`** `[phase 3]` Currently calls `agent.runAgent(options)` with the 14-field options object. Phase 3 replaces this with a single `queryRunner.run(perQueryInput)` call. The durable fields (model, betas, tools, system prompts, cache TTL, compaction, etc.) are held by the caller of `runAgent` (main.ts) and passed once at setup; `runAgent` itself takes only the per-query input.
- **`apps/claude-sdk-cli/src/AgentMessageHandler.ts`** `[keep]` Message handler reads events from the channel. Unchanged. Its subscriptions to the channel's events are already set once at startup.
- **`apps/claude-sdk-cli/src/gitDelta.ts`** `[keep]` Source of the `systemReminder` string passed to `queryRunner.run`. Unchanged.
- **`apps/claude-sdk-cli/src/systemPrompts.ts`** `[keep]` Durable system prompts. Unchanged.

### Files deleted in phase 3

Consolidated list of deletions:

- `packages/claude-sdk/src/private/AgentRun.ts`
- `packages/claude-sdk/src/private/AnthropicAgent.ts`
- `packages/claude-sdk/src/public/createAnthropicAgent.ts`
- `packages/claude-sdk/src/private/ConversationStore.ts`
- `packages/claude-sdk/src/private/MessageStream.ts` (replaced by `StreamProcessor.ts`)
- `packages/claude-sdk/test/AgentRun.spec.ts` (replaced by `TurnRunner.spec.ts` and `QueryRunner.spec.ts`)

### Public surface changes in phase 3

- `RunAgentQuery` type: deleted. Replaced conceptually by the per-query input shape the query runner takes.
- `AnthropicAgentOptions` type: deleted or stripped. `historyFile` removed. `authToken` and `logger` move into whatever factory is used to construct the Client.
- `IAnthropicAgent` abstract class in `interfaces.ts`: deleted.
- `index.ts` re-exports: updated to reflect the new public API (new block classes, removed old types).
- `SdkQuerySummary.systemReminder` field at `types.ts:61`: kept. The field is used by `AgentMessageHandler.ts:120` to append the reminder to the streamed line output; this display behaviour is separate from the SDK-side handling.

### Open decisions flagged for later

These are style and naming calls that do not block phase 2 but need to be resolved before or during phase 3.

1. `AnthropicAuth` export status. Currently exported as public API at `index.ts:31`. Stays exported, becomes internal, or renamed? Decide before phase 3.
2. `Auth/` directory move to `Client/Auth/`. Style call to make the Client block's scope visible. Decide before phase 3.
3. `ApprovalState` → `ApprovalCoordinator` rename. Match plan naming or keep current. Decide before phase 3.
4. `AgentChannel` → `ControlChannel` rename. Same. Decide before phase 3.
5. `Conversation.setHistory(msgs[])` as an explicit method, or restoration via a loop of `push` calls. Decide during phase 2 when writing the new block wiring. The plan deliberately does not pin this because it is an implementation detail.
6. Whether `ToolRegistry`, `TurnRunner`, `QueryRunner`, `StreamProcessor` each have behavioural interfaces (abstract classes) in `interfaces.ts`, or are concrete classes only. Follows the plan's "substitution happens through behavioural interfaces" principle, but the exact interface surface is decided when the classes are written in phase 2.

---

*End of file map section. The ordered execution steps and the gotchas folded into those steps come next, pending review of this file map.*
