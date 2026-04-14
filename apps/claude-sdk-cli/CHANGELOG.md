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

### Changed

- Move source files into `model/`, `view/`, and `controller/` subdirectories; add biome.json boundary enforcement

### Fixed

- Fix `GitStateMonitor` reporting the agent's own file edits and commits as human activity between turns
- Fix `gatherGitSnapshot` crashing when any git command fails (e.g. `rev-parse HEAD` in a repo with no commits)
- Fix `--init-config` to include all schema options in generated file
