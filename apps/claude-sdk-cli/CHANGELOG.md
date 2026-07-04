# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add --config flag to override any config value with a JSON object
- Add --file flag to start with a file as the first message
- Add --model flag: launch-time model override
- Add --name flag: display label for the session
- Add --no-resume flag: skip auto-resume of the latest session for the cwd
- Add --prompt flag: send an initial message at launch
- Add --resume <conversationId> flag to resume a specific conversation by UUID
- Add `thinking` config (enabled, effort) for extended thinking
- Add a history view to navigate and inspect past blocks in the active session
- Add approval notification hook: run a command when tool approval is pending
- Add command-mode model sub-mode (`m`): `t` toggles thinking, `e` cycles effort, surfaced in the status line
- Add compact config: control compaction enabled, token threshold, pause, and custom instructions via `sdk-config.json`
- Add ConversationSession: persistent conversation identity and n key to start new conversation
- Add image paste from clipboard via command mode
- Add maxTokens to config (default 32000)
- Add per-source CLAUDE.md loading control
- Add the Memory tool: a persistent, shared, relevance-searchable memory Claude reads and writes across sessions
- Add tools config to select execution tools; ExecV2 enabled by default, Exec (V1) off
- Add web search and web fetch as built-in server tools
- Allow --file to be specified multiple times; files attach in argument order
- Configurable system prompts via SYSTEM.md, --system, and sdk-config
- Configure tool approval permissions via a permissions block in sdk-config.json
- Decode escape sequences in --prompt values: \n, \r, \t, \\
- Display server tool use as its own block in the conversation
- ESC while a tool is running cancels the tool instead of the query, so Claude receives the cancellation and can continue
- Flash tool approval prompt with inverted colours when awaiting Y/N
- Format 1M+ token counts with M suffix in the status bar
- Mark model with * suffix in status bar when overridden via --model
- Ref and PreviewEdit state is now persisted to disk
- Register TypeScript language tools (TsDiagnostics, TsHover, TsReferences, TsDefinition) in the CLI
- Render assistant responses as styled markdown in the terminal
- Retry on internal server error
- Retry transient API errors with exponential backoff and jitter before surfacing the error
- Section dividers show when each section started, ended, and how long it took
- Show conversation id in status bar, controlled by statusBar.showConversationId config (default true)
- Show turn count on the status line
- Show user, tools, and claude time totals in the status line
- Show working directory name in status bar
- Support reading PDF and image files as native API content blocks
- Survive a mid-turn network drop: keep the machine awake during a request, persist the conversation as each message is sent and answered, and resume an interrupted turn from an empty submit
- Track session history per working directory for future session picker
- Write BetaMessage per turn to ~/.claude/audit/<conversation-id>.jsonl

### Changed

- Adopt core-di-lite property injection end to end: the container resolves the whole graph eagerly, SQLite databases are created through a registered factory, and CLI startup moves into main() so the entry module's only import-time effect is invoking it
- Config system tracks which file each value came from
- Hook input delivered via stdin instead of command arguments
- Internal: split AppLayout into TerminalRenderer, TerminalInput, View, and PrimaryView for future peer views
- Introduce core-di-lite for dependency resolution; separate composition from logic
- List --file in --help output
- Move source files into `model/`, `view/`, and `controller/` subdirectories; add biome.json boundary enforcement
- Repaint every TUI row each frame, resilient to external grid mutation (e.g. tmux reflow)
- Rewrite the project documentation: what the CLI is, why you would use it, and how to install, configure, run, and extend it
- Set the launcher process title to claude-sdk-cli so the launcher process can be matched by name, alongside the SEA binary it runs
- Ship the CLI as a prebuilt Single Executable Application: a per-platform binary (macOS arm64) is selected via an optional dependency and run through a launcher, so the node:sqlite store runs on the bundled Node 26 regardless of the Node the shell resolves
- Show model version alongside model name in the status bar
- Show tool input JSON as it streams
- Split model identifier into name and version for separate use
- Update runtime and build dependencies
- Updated patch and minor dependencies
- Updated patch dependencies
- Write session ID marker on save instead of on creation

### Fixed

- Add `typescript` as a production dependency so consumers do not need it installed separately
- Apply biome formatting fixes
- Default `compact.enabled` to `false`
- Delete the whole grapheme cluster on backspace and forward delete, so an emoji like ❤️ is removed in one keypress instead of leaving a stray character behind
- Disable extended thinking correctly: send `thinking: {type: "disabled"}` and omit `output_config` when thinking is off
- Fix `--init-config` to include all schema options in generated file
- Fix `gatherGitSnapshot` crashing when any git command fails (e.g. `rev-parse HEAD` in a repo with no commits)
- Fix `GitStateMonitor` reporting the agent's own file edits and commits as human activity between turns
- Fix colour loss when syntax-highlighted code scrolls off screen
- Fix divider width calculation for emoji labels
- Fix garbled cursor rendering on emoji characters
- Fix pipe stages being silently auto-denied by the permission system, and report an unknown tool as a lookup failure rather than a false user rejection
- Fix streaming tool render regression from the main merge
- Fix the CLI crashing at startup
- Hook commands support ~, $HOME, and relative paths
- Keep the editor cursor on a grapheme boundary after an insert that fuses with the following character (combining marks, regional-indicator flags, skin-tone modifiers, ZWJ sequences, VS16), so a later delete can no longer split the cluster into broken codepoints
- Preserve editor content when starting a new conversation
- Prevent crashes from unhandled child process and socket errors
- Reject unknown flags at launch instead of silently ignoring them
- Restore cursor visibility after exiting the CLI (#277)
- Show the permissions notice only when displayed permissions change, not on every config edit
- Stop duplicated content (ghost text) stranding at the wrap boundary in the TUI: the renderer now builds and diffs a cell grid and writes every row at an absolute position with autowrap disabled
- Stop the CLI freezing on an account-limit retry-after wait; retries are capped, ESC-abortable, and give up with a single account-limit notice
- Up/down arrows now move between visual rows when input wraps, instead of skipping over the wrapped portion
- Write session marker and history at turn start so they survive mid-response crashes

### Security

- Fix GHSA-p7fg-763f-g4gf: insecure file permissions in @anthropic-ai/sdk memory tool ([GHSA-p7fg-763f-g4gf](https://github.com/advisories/GHSA-p7fg-763f-g4gf))
