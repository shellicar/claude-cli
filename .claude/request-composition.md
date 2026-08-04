# Request Composition and the Caching Contract

Every request to the Anthropic API is assembled from three regions, in this order: `tools`,
`system`, `messages`. Prompt caching matches on an exact prefix, so a change to any region
invalidates that region and everything after it. Tools sit first, which is why a single toggled
tool costs the entire cached prompt.

This document is the reference for what goes into each region, who builds it, and what can change
it. It exists so that a change to any of those things can be checked against the caching contract
before it ships, rather than discovered later as a cost increase.

**Keeping it current.** Any change that adds a content block, adds a source of prompt text, moves a
cache breakpoint, or introduces a new way for one of the regions to vary belongs here in the same
change. The invariants near the end are the part that must not silently rot: if a change breaks one,
either the change is wrong or the invariant needs re-deciding on purpose.

## The four cache breakpoints

The API allows at most four `cache_control` breakpoints per request. All four are spent, and there
is no headroom. They are applied in `RequestBuilder.buildRequestParams` against a request-only clone
of the conversation (`Conversation.cloneForRequest`), so no marker is ever stored in history.

| # | Position | Applied by | Behaviour |
|---|----------|-----------|-----------|
| 1 | Last tool in the `tools` array | `buildRequestParams` | Static. Covers every tool. |
| 2 | Last block of the `system` array | `buildRequestParams` | Static. Covers tools plus system. |
| 3 | `content[cachedReminders.length - 1]` of the first user message | `cacheClaudeMdPrefix` | Pinned. Covers the skill catalogue and CLAUDE.md. |
| 4 | Last non-thinking block of the last user message | `cacheLastUserMessage` | Moves forward each turn, so only new content is a write. |

Breakpoint 3 exists only when there is cached reminder content. With CLAUDE.md present the request
spends all four, so any future feature needing a fifth breakpoint is rejected by the API and needs a
different design.

Breakpoint 3 is positional, not content-addressed. It counts blocks using the live
`cachedReminders.length` and applies that index to frozen history. A sanity guard refuses to mark a
block that is not a `<system-reminder>`, but the guard cannot tell CLAUDE.md apart from any other
reminder, so it catches an unexpected shape and nothing more.

## Region 1: tools

Built in `DurableConfigFactory.#build()`, converted to wire form in `RequestBuilder.toWireTool`, then
passed through `transformTool`.

Order on the wire is server tools first, then client tools.

**Server tools** come from `buildServerTools`: `web_search` and `web_fetch`, each carrying its
version and `allowed_callers`. When advanced tool use is enabled, `tool_search_tool_regex` or
`tool_search_tool_bm25` is appended.

**Client tools** are the array `createAppTools` builds once at startup, filtered by
`config.disabledTools`. Each becomes `{ name, description, input_schema, input_examples }`, where the
schema is generated from the tool's zod type. `transformTool` is
`withPathNote(buildAtuTransform(...))`: the ATU transform adds `defer_loading` and `allowed_callers`
when advanced tool use is on and strips `input_examples` when it is off, and the path note appends a
normalisation sentence to every `isPath`-marked schema field.

No tool description or schema is derived from live session state. Az and Azure DevOps account
configuration in particular never reaches a schema.

### What changes this region

Fixed for the life of the process:

- `tools.exec`, `tools.execV2`, `tools.execV3`
- `skillDirs`
- `tsAvailable`, which is `tsserverPath != null`. When typescript cannot be resolved the four TS
  tools are left out entirely, so a SEA launch and a dev launch can send different tool sets.

Changeable at runtime through config reload, with no restart:

- `disabledTools`
- `serverTools.webSearch` and `serverTools.webFetch`, including version and allowed callers
- `advancedTools.enabled`, `.searchTool`, `.codeExecutionTool`, `.allowProgrammaticExecution`

The advanced tool use toggle is the widest of these because it rewrites every tool object, not just
the array membership.

## Region 2: system

Assembled in `RequestBuilder.buildRequestParams` as `[AGENT_SDK_PREFIX, ...options.systemPrompts]`,
where `systemPrompts` comes from `DurableConfigFactory`.

1. `AGENT_SDK_PREFIX`, a constant.
2. The `<system-identity>` block, if an identity body is present.
3. The output of `composeSystemPrompts`: SYSTEM.md sections in source order (user, project,
   projectClaude, local) each wrapped in `<system-md>`, then `config.systemPrompt.text`, then the
   `--system` flag text wrapped in `<system-md>`.

Item 3 is resolved once per session by `resolveSystemPromptsFor(sessionId)` and reused until the
session id changes. Item 2 is read from disk on every turn by `TurnCoordinator.runTurn` and pushed in
through `updateIdentityBody`.

### What changes this region

- The identity file changing on disk, picked up on the next turn.
- A new session id, which re-resolves SYSTEM.md, the config text and the flag.
- `--system` at launch, and `config.systemPrompt.*` at reload.

The identity sits at position 2, ahead of everything else. Reordering it would not help on its own:
with one breakpoint at the end of the region, a change anywhere in the region costs the whole region.
Confining the loss would require a breakpoint between the stable and volatile parts, and there is
none spare.

## Region 3: messages

The array sent is `trimToLastCompaction(items)`, deep-cloned per request. A compaction therefore
replaces the message array wholesale rather than appending to it.

### Block types on the wire

User-role messages carry:

- `text` for `<system-reminder>` blocks, the clock stamp, and the operator's own prompt
- `tool_result`, whose content is a text block followed by any native `document` or `image`
  attachments a tool returned
- `compaction` blocks, converted to `text` when compaction is disabled

Assistant-role messages carry `text`, `thinking`, `redacted_thinking`, `tool_use`,
`server_tool_use`, `compaction`, and the server tool result types: `web_search_tool_result`,
`web_fetch_tool_result`, `code_execution_tool_result`, `bash_code_execution_tool_result`,
`text_editor_code_execution_tool_result`, `tool_search_tool_result`, `mcp_tool_result`. The mapping
lives in `TurnRunner.mapBlock`.

### The reminder inventory

Seven producers put `<system-reminder>` blocks into messages. Position relative to breakpoints 3 and
4 is what decides whether a reminder is cached, so it is the column that matters.

| Reminder | Source | Read when | Placement | In history | Relative to marker |
|----------|--------|-----------|-----------|------------|--------------------|
| Skill catalogue | `resolveSkillCatalogue()` | Startup, once | Leading, first user message | Yes | Inside breakpoint 3 |
| CLAUDE.md and `--claudeMd` | `ClaudeMdLoader.getContent()` | Every turn | Leading, first user message | Yes | Breakpoint 3 sits on it |
| Scratchpad | `DurableConfigFactory.#conversationReminders()` | Derived per config read | Leading, after the cached run | Yes | After breakpoint 3 |
| Skill catalogue delta | `SkillCatalogueTracker.scanForDelta()` | Per query | Leading, that query's message | Yes | After breakpoint 3 |
| Working directory | `CwdTracker.scanForDelta()` | Per query | Leading, that query's message | Yes | After breakpoint 3 |
| Git delta | `GitStateMonitor.getDelta()` | Per query | Trailing | No | After breakpoint 4, deliberately uncached |
| Clock stamp | `TurnRunner` | Every turn, on the tip | After the leading run, before real content | Yes | After breakpoint 3 |

`QueryRunner` composes the leading run in breakpoint order: cached reminders first, then
conversation reminders, then the query's own persisted-leading reminders. That order is what keeps
breakpoint 3 on the last cached block.

The clock stamp is written by `TurnRunner` directly into the conversation tip before the request
clone is taken. It skips any leading `tool_result` and any leading `<system-reminder>` so it lands
immediately before the message's real content, and a stale stamp from a rolled-back attempt is
stripped before the new one goes in. A tip that is nothing but a leading run, which is what a
tool-loop continuation looks like, is left unstamped.

### What rewrites message history

These change messages that have already been sent, so they move content under the cache:

- `TurnRunner` calls `healDanglingToolUse` before every request
- `QueryRunner.removeLast()` on the empty-tool-use retry, up to twice
- Role-alternation merge in `Conversation.push`: a cancelled query followed by a new prompt merges
  two user messages into one that was already on the wire
- Compaction, which replaces the whole slice
- `ConversationSession` calling `setHistory` on resume or new session
- `Conversation.remove(id)` exists on the interface for tagged pruning but has no CLI caller yet

## Outside the three regions

These are not part of the message prefix but are part of the cache key or otherwise invalidate it.
They are worth listing because several are reachable by a single keypress.

- `model`. Changed by the `--model` flag, by config reload, or at runtime through
  `ModelOverrides.setModel`. A model change is a total miss.
- `thinking` and `output_config.effort`. Bound to the `t` and `e` keys in command mode via
  `ModelOverrides.cycleThinking` and `cycleEffort`. Changing thinking parameters invalidates cached
  message blocks. This is documented Anthropic behaviour rather than something proven in this
  codebase, and should be confirmed before being relied on.
- `betas`. The advanced tool use flag changes both the beta header and the shape of every tool.
- `context_management` edits and the `compact` config.
- `cacheTtl`, currently hardcoded to one hour in `DurableConfigFactory`.

## Invariants

Break one of these and caching degrades quietly. Nothing fails loudly.

1. **Ephemeral reminders must be trailing.** `RequestBuilder` honours `position: 'leading'` for an
   ephemeral reminder by unshifting it onto the head of the last user message, which puts it inside
   breakpoint 4's prefix. Because it is not persisted, the next turn sends that message without it,
   the prefix no longer matches, and the whole conversation tail falls out of cache. Nothing produces
   a leading ephemeral reminder today. Nothing should.
2. **Anything read per turn must not reach regions 1 or 2.** A file read on every turn is a file that
   can change between turns, and a change in tools or system costs everything downstream.
3. **The leading reminder run stays in breakpoint order.** Cached reminders first, then anything that
   varies. A new reminder added ahead of the cached run moves breakpoint 3 onto the wrong block.
4. **`cachedReminders.length` must agree with what is frozen in the first user message.** Breakpoint
   3 is an index, not a match. If the count changes while history does not, the marked prefix stops
   corresponding to what was cached.
5. **Availability is not membership.** Telling the model a tool cannot be used belongs in a reminder
   after the breakpoints. Removing it from the `tools` array invalidates from the very start of the
   request. `ToolRegistry.resolve` already refuses a disabled tool with `unavailable` regardless of
   what the wire list contains, so enforcement does not depend on membership.

## Known gaps

Recorded here so they are not rediscovered. None are fixed yet.

- **Compaction can permanently drop CLAUDE.md.** `ensureClaudeMdReminders` decides the reminders are
  already present by testing whether the first block of the first user message is a
  `<system-reminder>`. The clock stamp is also a `<system-reminder>`, and `TurnRunner` writes it
  before that check runs. On the first turn after a compaction, when the tip is also the first user
  message of the surviving slice, the stamp lands at index 0, the guard trips, and CLAUDE.md plus the
  skill catalogue are never re-injected for that turn or any turn after it. Breakpoint 3 then marks
  the stamp block instead.
- **`disabledTools` filters the wire list.** Toggling a tool changes region 1, so it invalidates the
  entire cached prompt. See invariant 5 for where that decision should live instead.
- **`ConfigDisabledToolsProvider` is dead on the request path.** It computes an identity-aware
  disabled set covering `AzCli`, `EscalatedAzCli` and the Azure DevOps PR tools, and
  `ToolRegistry.wireTools` consumes it, but the request path builds tools from
  `DurableConfigFactory`, which filters on raw `config.disabledTools`. Those tools reach the wire
  whether or not an identity is configured, despite the provider's comment claiming otherwise.
- **Per-turn file reads.** CLAUDE.md and the system identity body are both read on every turn. The
  intended policy is to read them once and re-read only across a compaction, since that is the point
  at which the message prefix is being rebuilt anyway.

## Measured behaviour

Within a single session the caching is already optimal. Across 40 consecutive turns of a 408-turn
session, every turn's `cache_read` equalled the previous turn's `cache_read + cache_creation`
exactly, meaning the prefix was never re-written. Across sessions, the first request reads roughly
29k tokens, which is tools plus system surviving the restart, and writes the reminder run, which
differs per project.
