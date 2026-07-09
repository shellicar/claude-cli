# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add `CompactConfig` type; `cloneForRequest` converts compaction blocks to text when compact is disabled
- Add Claude Sonnet 5 calibration and fall back to a family's most recent known config for unrecognised model versions
- Add finalMessage event emitter surface to AnthropicClient
- Add output_schema to ToolDefinition for typed handler outputs
- Add support for Claude Fable 5
- Add support for Claude Opus 4.8
- Add updateIdentityBody to the durable config provider, folding a live system-identity body in as the first system prompt on the next config read
- Classify a mid-stream connection drop and retry it on a bounded fixed schedule instead of surfacing it as a fatal error, with injection seams to hold a wake lock and signal a reconnect
- Deliver tool attachments as native content blocks inside tool results
- Emit canonical per-turn content on the control channel after each turn
- Emit enter_block and exit_block events from content_block_start and content_block_stop
- ESC while a tool is running cancels the tool and delivers a cancellation result to Claude; ESC otherwise ends the query
- Export `IMessageStreamer` from the public barrel
- Inject a live per-turn date/time stamp into every request
- Mark a tool-schema field as a filesystem path and normalise all marked paths once from that marker, so the display, the permission check, and handler execution read one produced path
- Stamp `messageId`, `turnId`, and `queryId` into each conversation record as nested fields, carried through the jsonl save and load round-trip
- Support tool search for on-demand tool discovery
- Support tool use examples in tool definitions

### Changed

- Adopt core-di-lite property injection across the SDK: dependencies resolve through declared injected properties instead of hand-wired constructors, and the injection contracts are exported as abstract-class tokens
- Conversation retains full message history across compaction; adds internal `cloneForRequest()` that returns a deep-cloned post-compaction slice for API requests
- Extract `AnthropicClient` from `AnthropicAgent`: auth, token refresh, and HTTP transport now live in a dedicated private class. `AnthropicAgent` becomes a thin composer that holds a client and a conversation. The previous `AnthropicMessageStreamer` wrapper is removed; `AnthropicClient` extends `IMessageStreamer` directly.
- Omit empty `context_management` from request body instead of sending empty edits array
- Refactor stream processor to use SDK native event emitter
- Replace `AnthropicBeta.Compact` enum member with standalone `COMPACT_BETA` constant
- Replace MessageChannel-backed control channel with async-ordered pub/sub
- Replace the @anthropic-ai/sdk runtime with an owned fetch/SSE transport, so retry-after waits are capped and abortable instead of honoured uncapped
- Replace the placeholder README with a short description and a link to the main documentation
- Support multiple system prompt sources as separate wire blocks
- Tool handlers return structured output with optional attachments for binary content
- Update runtime and build dependencies
- Updated patch and minor dependencies
- Updated patch dependencies

### Removed

- Remove deprecated InterleavedThinking beta header

### Fixed

- Bracket the whole tool-handling method as tool time, so the tools clock includes the approval wait
- Calculate costs for Opus 4.7
- Carry structured API error detail (status, type, message) to consumers, not only the status
- Fix context window size for Opus 4.6, Opus 4.7, and Sonnet 4.6 (200k to 1M)
- Fix context window size for Sonnet 4 (200k to 1M)
- Keep CLAUDE.md context present in every request after compaction (it previously dropped out)
- Package now publishes CJS alongside ESM with working sourcemaps
- Preserve redacted_thinking blocks in conversation history
- Preserve server tool blocks (server_tool_use, web_search_tool_result, web_fetch_tool_result) in conversation history
- Retry when the model returns a malformed tool call
- Show thinking text when using Opus 4.7

### Security

- Fix GHSA-p7fg-763f-g4gf: insecure file permissions in @anthropic-ai/sdk memory tool ([GHSA-p7fg-763f-g4gf](https://github.com/advisories/GHSA-p7fg-763f-g4gf))
