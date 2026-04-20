# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add finalMessage event emitter surface to AnthropicClient
- Add `CompactConfig` type; `cloneForRequest` converts compaction blocks to text when compact is disabled
- Support tool search for on-demand tool discovery
- Support tool use examples in tool definitions

### Changed

- Conversation retains full message history across compaction; adds internal `cloneForRequest()` that returns a deep-cloned post-compaction slice for API requests
- Extract `AnthropicClient` from `AnthropicAgent`: auth, token refresh, and HTTP transport now live in a dedicated private class. `AnthropicAgent` becomes a thin composer that holds a client and a conversation. The previous `AnthropicMessageStreamer` wrapper is removed; `AnthropicClient` extends `IMessageStreamer` directly.
- Replace `AnthropicBeta.Compact` enum member with standalone `COMPACT_BETA` constant
- Omit empty `context_management` from request body instead of sending empty edits array

### Fixed

- Package now publishes CJS alongside ESM with working sourcemaps
