# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A running session can now move to another working directory from command mode, without restarting the process
- Add --config flag to override any config value with a JSON object
- Add --file flag to start with a file as the first message
- Add --model flag: launch-time model override
- Add --name flag: display label for the session
- Add --no-resume flag: skip auto-resume of the latest session for the cwd
- Add --prompt flag: send an initial message at launch
- Add --resume <conversationId> flag to resume a specific conversation by UUID
- Add --system-identity flag so a conversation owns the actor it casts Claude as, persisted in sqlite and restored on resume
- Add `thinking` config (enabled, effort) for extended thinking
- Add a --claudeMd flag to contribute a string to the assembled CLAUDE.md content at launch
- Add a history view to navigate and inspect past blocks in the active session
- Add a model selector to command mode (Ctrl+/ m m): free-text model entry that always sends, with a blue highlight when the typed id matches a known model. Shares one override slot with the --model flag; empty submit clears back to the config model
- Add approval notification hook: run a command when tool approval is pending
- Add command-mode model sub-mode (`m`): `t` toggles thinking, `e` cycles effort, surfaced in the status line
- Add compact config: control compaction enabled, token threshold, pause, and custom instructions via `sdk-config.json`
- Add ConversationSession: persistent conversation identity and n key to start new conversation
- Add gh privilege escalation: every exec call runs read-only under a reader Keychain credential; six named PullRequest tools briefly use a separate holder credential for one call and always prompt for approval first
- Add image paste from clipboard via command mode
- Add maxTokens to config (default 32000)
- Add per-source CLAUDE.md loading control
- Add secrets.ghScoping config (default false): opt-in gh token scoping for exec calls, since it requires macOS arm64 and a Keychain reader item created out of band by the operator
- Add the --system-identity flag: bind a system prompt to a conversation from a file, persisted and restored on resume
- Add the Memory tool: a persistent, shared, relevance-searchable memory Claude reads and writes across sessions
- Add the skillDirs config setting: an ordered, replacement-only list of skill roots the Skill tool resolves across, with later roots overriding earlier ones and an empty list resolving nothing
- Add tools config to select execution tools; ExecV2 enabled by default, Exec (V1) off
- Add tools.blockedCommands config: extra command patterns ExecV3 refuses to start
- Add web search and web fetch as built-in server tools
- Added az.accounts config, a closed set of named Azure accounts (tenant ID plus reader/holder service principal client IDs) the AzCli/EscalatedAzCli and AzureDevOps_PullRequest_* tools select between
- Added ISecrets.adoHolderToken(), read from Keychain (service '@shellicar/credentials', account 'ado-holder'), for the AzureDevOps_PullRequest_* escalated tools
- Added ISecrets.azCert(account, identity), read from Keychain as az-<account>-<identity>-cert, backing the Az and AzureDevOps tool packages' certificate-based service principal logins
- Added secrets.azReaderConfigDir and secrets.azHolderConfigDir config fields, selecting the AZURE_CONFIG_DIR profile AzCli and EscalatedAzCli run under
- Allow --file to be specified multiple times; files attach in argument order
- Configurable system prompts via SYSTEM.md, --system, and sdk-config
- Configure tool approval permissions via a permissions block in sdk-config.json
- Decode escape sequences in --prompt values: \n, \r, \t, \\
- Display server tool use as its own block in the conversation
- ESC while a tool is running cancels the tool instead of the query, so Claude receives the cancellation and can continue
- Flash tool approval prompt with inverted colours when awaiting Y/N
- Format 1M+ token counts with M suffix in the status bar
- Index every committed turn to a searchable history store, with a migration for old audit files, a rebuild script, and a background sweep that collapses near-duplicates
- Inject a skill-catalogue delta: re-scan the skill roots each query and prepend a system-reminder naming the skills whose SKILL.md content changed, silent on the first scan of a session and after a resume
- Inject the available-skills catalogue as a cached system-reminder on the first user message, scanned from skillDirs at startup and re-injected after compaction, so the model can discover skills to load
- Mark model with * suffix in status bar when overridden via --model
- Publish conversation activity as opt-in NATS tap events
- Publish the agent concern: ready/pulse/attached/detached telemetry and service/drain/chdir requests
- Ref and PreviewEdit state is now persisted to disk
- Register TypeScript language tools (TsDiagnostics, TsHover, TsReferences, TsDefinition) in the CLI
- Render assistant responses as styled markdown in the terminal
- Retry on internal server error
- Retry transient API errors with exponential backoff and jitter before surfacing the error
- Scroll the conversation transcript back with the mouse wheel or PageUp/PageDown to read earlier output; the editor and status bar stay pinned
- Search your conversation history: SearchHistory finds past moments by full-text search, ReadHistory opens them with the surrounding turns
- Section dividers show when each section started, ended, and how long it took
- Service `say` and `cancel` on the conversation over NATS and raise and answer tool approvals over the wire, so a client can address the CLI and drive a turn remotely
- Show conversation id in status bar, controlled by statusBar.showConversationId config (default true)
- Show the --resume flag for the current conversation on clean exit
- Show the CLI's own build version, dimmed, at the end of the status bar
- Show turn count on the status line
- Show user, tools, and claude time totals in the status line
- Show working directory name in status bar
- Support reading PDF and image files as native API content blocks
- Survive a mid-turn network drop: keep the machine awake during a request, persist the conversation as each message is sent and answered, and resume an interrupted turn from an empty submit
- Tell the model the working directory: state it up front, and report the from/to when it changes mid-session
- Track session history per working directory for future session picker
- Write BetaMessage per turn to ~/.claude/audit/<conversation-id>.jsonl

### Changed

- --config startup display now shows only the keys the payload actually named, not the full merged config
- Adopt core-di-lite property injection end to end: the container resolves the whole graph eagerly, SQLite databases are created through a registered factory, and CLI startup moves into main() so the entry module's only import-time effect is invoking it
- Block header dividers now pad to a fixed minimum width instead of the full terminal width, so the trailing run of hyphens no longer scales with the window while short headers still line up
- claude-cli now records each session's directory to a central store and resumes the most-recent session for the current directory, so a conversation survives a restart or a machine going away
- Command mode can now be entered, navigated, and exited while a query is streaming, not only in the editor phase
- Config system tracks which file each value came from
- Distinguish an auto-denied tool call from a real human rejection: the model now receives a reason naming the policy, not a signal that a user saw and refused the call
- Hook input delivered via stdin instead of command arguments
- Internal: split AppLayout into TerminalRenderer, TerminalInput, View, and PrimaryView for future peer views
- Introduce core-di-lite for dependency resolution; separate composition from logic
- Keychain platform/arch support check now reads through IFileSystem instead of process.platform/process.arch directly
- List --file in --help output
- Move source files into `model/`, `view/`, and `controller/` subdirectories; add biome.json boundary enforcement
- Read the SDK-normalised path in the display summary and the permission check instead of each re-deriving it, removing the two hand-maintained path inspectors
- Repaint every TUI row each frame, resilient to external grid mutation (e.g. tmux reflow)
- Resize and normalise a pasted image before it is attached, so an oversized image can no longer exceed the request-size limit and take down the conversation
- Rewrite the project documentation: what the CLI is, why you would use it, and how to install, configure, run, and extend it
- Secrets retries a transient Keychain read failure with backoff before giving up
- Serve the assembled CLAUDE.md prefix from cache on repeat launches instead of paying for it each turn
- Set the launcher process title to claude-sdk-cli so the launcher process can be matched by name, alongside the SEA binary it runs
- Ship the CLI as a prebuilt Single Executable Application: a per-platform binary (macOS arm64) is selected via an optional dependency and run through a launcher, so the node:sqlite store runs on the bundled Node 26 regardless of the Node the shell resolves
- Show model version alongside model name in the status bar
- Show tool input JSON as it streams
- Spawn the TypeScript server on demand for each tool block and tear it down after, replacing the always-on server that ran for the whole session
- Speak the conversation concern's v2 tree (leafed subjects, query closure, per-frame usage) instead of v1
- Split a tool turn into two transcript blocks, tool use (the model's request) and execution (the run), so the execution block's timing reflects the actual run including the approval wait rather than only the tool-call generation; both the primary and history views show input on the use block and input plus output on the execution block
- Split model identifier into name and version for separate use
- Split secrets.ghScoping into two independent settings: secrets.stripGhCredentials (opt-out, default true) controls whether exec strips ambient gh/ssh credentials, and secrets.ghScoping (opt-in, default false) controls whether a Keychain-scoped replacement is injected. Previously stripping was unconditional, so anyone relying on their own ambient GH_TOKEN reaching exec had no way to keep it, even with ghScoping off
- The --verify check now boot-checks the tsserver with a one-shot spawn instead of only looking for its path
- The user-level CLAUDE.md and SYSTEM.md sources now default off, so nothing is silently concatenated into a session at launch; project, projectClaude and local sources are unchanged, and setting user back to true in config remains supported
- Throttle streaming markdown decoration to run at most once per 120ms; new text appears immediately as plain text between refreshes and is replaced with the fully styled render on the next refresh, instead of paying full markdown decoration cost on every delta
- Update runtime and build dependencies
- Updated patch and minor dependencies
- Updated patch dependencies
- Wrap injected content presented to the model (attachments, git delta, CLAUDE.md, SYSTEM.md, system identity) in XML-like tags instead of custom markers, so the model-facing format is consistent
- Write session ID marker on save instead of on creation

### Removed

- Remove the one-way `tap.v1` telemetry stream, replaced by the `conv` and `approval` wire surface
- Remove the PreviewEdit tool; EditFile now validates, writes, and returns a diff in one call

### Fixed

- Add `typescript` as a production dependency so consumers do not need it installed separately
- Apply biome formatting fixes
- Attachments added while a query is streaming are no longer cleared once that query finishes
- Count tool approval wait time as tool time in the status-line clock
- Default `compact.enabled` to `false`
- Delete the whole grapheme cluster on backspace and forward delete, so an emoji like ❤️ is removed in one keypress instead of leaving a stray character behind
- Disable extended thinking correctly: send `thinking: {type: "disabled"}` and omit `output_config` when thinking is off
- Fix `--init-config` to include all schema options in generated file
- Fix `gatherGitSnapshot` crashing when any git command fails (e.g. `rev-parse HEAD` in a repo with no commits)
- Fix `GitStateMonitor` reporting the agent's own file edits and commits as human activity between turns
- Fix batch tool approvals: a local Y/N keypress now settles the tool you have selected by its request id, instead of the head of an anonymous queue. Previously one keypress could approve or deny a different tool in the same batch (or two at once)
- Fix colour loss when syntax-highlighted code scrolls off screen
- Fix divider width calculation for emoji labels
- Fix Exec crashing on every call on any platform other than macOS arm64, where gh token scoping unconditionally tried to read Keychain and threw when unavailable
- Fix garbled cursor rendering on emoji characters
- Fix npm install failing with a 404 on @shellicar/keychain-native by moving it to optionalDependencies now that it's a real published, macOS-arm64-only package
- Fix pipe stages being silently auto-denied by the permission system, and report an unknown tool as a lookup failure rather than a false user rejection
- Fix streaming markdown responses re-lexing and re-highlighting the entire accumulated response on every delta instead of only the newly arrived text, an O(n^2) cost that made long, code-heavy responses render increasingly slowly as they streamed in
- Fix streaming tool render regression from the main merge
- Fix the CLI crashing at startup
- Fix the TUI repainting every cell of every row on every frame, which made the once-a-second clock tick, every mouse-wheel scroll notch, and every keystroke rewrite the whole terminal; the renderer now diffs against the previous frame and writes only the rows that changed
- Hook commands support ~, $HOME, and relative paths
- Keep the editor cursor on a grapheme boundary after an insert that fuses with the following character (combining marks, regional-indicator flags, skin-tone modifiers, ZWJ sequences, VS16), so a later delete can no longer split the cluster into broken codepoints
- Preserve editor content when starting a new conversation
- Prevent crashes from unhandled child process and socket errors
- Reject unknown flags at launch instead of silently ignoring them
- Rendered markdown links no longer leak the OSC 8 escape or double the URL; ctrl-click opens the correct address
- Restore cursor visibility after exiting the CLI (#277)
- Self-heal a resumed session that crashed between a tool call and its result: an honest synthetic failure result is appended for each dangling tool_use before anything else touches the conversation
- Show the API error detail on a failed request instead of only the HTTP status
- Show the permissions notice only when displayed permissions change, not on every config edit
- Show the prompt block's start time when the prompt is entered, matching every other block
- Skip non-assistant audit lines when deriving the status-line token and cost figures
- Status line token stats reflect the current conversation, derived per conversation id, instead of accumulating over the process lifetime
- Stop duplicated content (ghost text) stranding at the wrap boundary in the TUI: the renderer now builds and diffs a cell grid and writes every row at an absolute position with autowrap disabled
- Stop the CLI freezing on an account-limit retry-after wait; retries are capped, ESC-abortable, and give up with a single account-limit notice
- Submitting with ctrl+enter now works while command mode is open, instead of requiring it to be closed first
- Up/down arrows now move between visual rows when input wraps, instead of skipping over the wrapped portion
- Write session marker and history at turn start so they survive mid-response crashes

### Security

- EnvProvider also strips SSH_AUTH_SOCK, so an ssh-remote git push or clone can no longer authenticate as the real ssh identity and bypass the gh token scoping
- Fix GHSA-p7fg-763f-g4gf: insecure file permissions in @anthropic-ai/sdk memory tool ([GHSA-p7fg-763f-g4gf](https://github.com/advisories/GHSA-p7fg-763f-g4gf))
