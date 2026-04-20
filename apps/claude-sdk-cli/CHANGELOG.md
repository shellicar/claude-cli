# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add ConversationSession: persistent conversation identity and n key to start new conversation
- Write BetaMessage per turn to ~/.claude/audit/<conversation-id>.jsonl
- Add compact config: control compaction enabled, token threshold, pause, and custom instructions via `sdk-config.json`
- Add image paste from clipboard via command mode
- Register TypeScript language tools (TsDiagnostics, TsHover, TsReferences, TsDefinition) in the CLI
- Add web search and web fetch as built-in server tools
- Display server tool use as its own block in the conversation
- Show working directory name in status bar
- Add --file flag to start with a file as the first message
- Flash tool approval prompt with inverted colours when awaiting Y/N
- Add approval notification hook: run a command when tool approval is pending
- Maintain session ID history file at ~/.claude/session-history

### Changed

- Move source files into `model/`, `view/`, and `controller/` subdirectories; add biome.json boundary enforcement
- Write session ID marker on save instead of on creation

### Fixed

- Add `typescript` as a production dependency so consumers do not need it installed separately
- Fix `GitStateMonitor` reporting the agent's own file edits and commits as human activity between turns
- Fix `gatherGitSnapshot` crashing when any git command fails (e.g. `rev-parse HEAD` in a repo with no commits)
- Fix `--init-config` to include all schema options in generated file
- Default `compact.enabled` to `false`
- Preserve editor content when starting a new conversation
- Restore cursor visibility after exiting the CLI (#277)
- Apply biome formatting fixes
