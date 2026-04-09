# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0-alpha.74] - 2026-04-02

### Fixed

- Keystroke render lag from redundant history wrapping eliminated (#169)
- Resize hang when column count changes eliminated (#170)

## [1.0.0-alpha.73] - 2026-03-30

### Fixed

- Rendering duplication, overlap, and input leaks during history mode (#162)

## [1.0.0-alpha.72] - 2026-03-30

### Added

- Alternate screen buffer rendering keeps terminal history intact on exit (#151)
- In-app scrollback with history mode and page/line navigation (#152)
- Range indicator shown during history scroll; editor hidden to reduce layout conflicts (#157)

### Fixed

- Zone anchored to bottom from startup rather than after first render (#156)
- Scrollback corruption when editor content exceeds terminal height (#147)
- Sticky zone no longer overflows the terminal viewport (#145)
- Cursor navigation in wrapped editor lines (#144)
- Lone surrogates stripped from user input before SDK submission (#143)
- Partial deletion of emoji and special characters now removes the full character (#142)
- Cursor moves by visible character width for emoji and special characters (#140)
- Terminal width calculations now use string-width for accurate Unicode handling (#139)
- Sticky zone width calculations corrected for ANSI content (#136)

## [1.0.0-alpha.71] - 2026-03-27

### Changed

- Updated `@shellicar/mcp-exec` to 1.0.0-preview.6
- Updated `@anthropic-ai/claude-agent-sdk` to 0.2.85, `@anthropic-ai/sdk` to 0.80.0
- Updated all dependencies to latest versions

### Fixed

- Exit with error when stdin is not a terminal (empty piped stdin no longer hangs)
- Slash commands no longer discard pending file attachments
- `session-clear` and `session-new` commands no longer exit command mode
- Suppress unhandled rejection crash when aborting a query early

### Security

- Fixed ReDoS vulnerability in picomatch ([GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj))
- Fixed method injection vulnerability in picomatch ([GHSA-3v7f-55p6-f55p](https://github.com/advisories/GHSA-3v7f-55p6-f55p))
- Fixed stack overflow vulnerability in yaml ([GHSA-48c2-rrv3-qjmp](https://github.com/advisories/GHSA-48c2-rrv3-qjmp))
- Fixed DoS vulnerability in smol-toml ([GHSA-v3rj-xjv7-4jmq](https://github.com/advisories/GHSA-v3rj-xjv7-4jmq))

## [1.0.0-alpha.70] - 2026-03-25

### Added

- `execPermissions` config: structured exec permission rules with presets and program/argument matching, superseding `execAutoApprove` (deprecated but still functional)
- Session ID persisted across aborts so sessions can be resumed after interruption

### Changed

- `@shellicar/mcp-exec` updated to 1.0.0-preview.5; exec approve rules are now additive

## [1.0.0-alpha.69] - 2026-03-22

### Changed

- `@shellicar/mcp-exec` updated to 1.0.0-preview.4; adopts unified step schema (`steps[].commands[]`) replacing the discriminated `command`/`pipeline` union

## [1.0.0-alpha.68] - 2026-03-20

### Changed

- Exec tool extracted to `@shellicar/mcp-exec` package; CLI retains only the auto-approve config layer
- `@shellicar/mcp-exec` updated to 1.0.0-preview.3 (ENOENT differentiation, merge_stderr, path expansion, structured output fix)

## [1.0.0-alpha.67] - 2026-03-17

### Added

- Structured command execution via in-process MCP server replaces freeform Bash with typed `{ program, args[] }` commands, pipelines, and validation rules
- Glob-based auto-approve for exec commands (`execAutoApprove` config)
- Text editor with cursor navigation, word jumping (Ctrl+Arrow), Home/End, and Ctrl+Backspace
- Clipboard paste support, including emoji and international characters
- Sticky zones keep the editor and status line pinned at the bottom while output scrolls above
- New queries are blocked while a response is in progress
- Session persistence and automatic resume across restarts
- Permission prompts for each tool call Claude makes, with timeouts and support for approving multiple tools at once
- Context window percentage and session cost in the status line
- Discovers and lists available Claude Code skills
- Audit log recording all queries and tool calls
- `/add-dir` to include extra directories in the current session
- `--version` and `--help` flags
- Multiline free-text replies to `AskUserQuestion` prompts from Claude
- Context providers inject the current time, context usage, session cost, and git branch state into every query
- Claude is warned when context usage exceeds 80% or 85% so it can wrap up or compact before running out of space
- Config file at `~/.claude/cli-config.json`; invalid values fall back to defaults rather than erroring. `/config` shows the resolved config
- Command mode (Ctrl+/) for pasting images and text from the clipboard, with attachment selection and preview
- `AskUserQuestion` prompts time out automatically if unanswered; the duration is configurable
- Permission timeout for plan mode is configurable and can be disabled
- Config hot-reload applies changes without restarting; changed fields are shown on reload
- Session controls in command mode (Ctrl+/ s): clear the session or start fresh while keeping the current todo list
- Configurable model for `/compact` so compaction does not use an expensive model
- Thinking mode and effort level are configurable
- Starting a new session preserves the current todo list
- Support for 1M token context window model variants
- Multi-select support for `AskUserQuestion` option prompts
- Per-project config file that overrides the home config
- `/model` command to switch model for the current session
- Ctrl+Enter support in all terminals and multiplexers, including tmux

### Changed

- Permission timeouts are reported separately from explicit denials
- Individual context features (git state, usage, time) can be disabled in config
- Permission and question prompts are highlighted; a visual flash and beep warn when 10 seconds remain
- Skill invocations no longer require manual approval
- Assistant responses are shown in bold white
- Config validation warnings are shown on startup and reload when values have been adjusted
- Audit logs moved to `~/.claude/audit/`, one file per session
- Context percentage now reflects the active model's actual context window
- `@anthropic-ai/claude-agent-sdk` updated to 0.2.72

### Fixed

- Empty multi-select submissions were blocked instead of passing through to the SDK
- Tool approval prompts no longer appear after a query has finished
- System prompt was incorrectly sent when running `/compact`
- Context percentage shown on startup was inflated after a compaction
- Ghost lines appearing when the status bar wrapped to a second row
- Tools were not disabled when context exceeded 85% during an active query
- Typing emoji or international characters in the editor silently lost the input
- `/add-dir` silently accepted non-existent paths and did not expand `~`
- Messages were lost during rapid terminal resize
- Image paste failed when running from the installed package
- Pasting unsupported BMP images produced corrupt output rather than an error
- Question countdown kept running after the user started typing a reply
- Context percentage and session cost were wrong after clearing or resuming a session
- Context percentage used the wrong model's window size when multiple models were active in a session

### Security

- Patched CVE-2026-27903 and CVE-2026-27904 in minimatch

[1.0.0-alpha.74]: https://github.com/shellicar/claude-cli/releases/tag/1.0.0-alpha.74
[1.0.0-alpha.73]: https://github.com/shellicar/claude-cli/releases/tag/1.0.0-alpha.73
[1.0.0-alpha.72]: https://github.com/shellicar/claude-cli/releases/tag/1.0.0-alpha.72
[1.0.0-alpha.71]: https://github.com/shellicar/claude-cli/releases/tag/1.0.0-alpha.71
[1.0.0-alpha.70]: https://github.com/shellicar/claude-cli/releases/tag/1.0.0-alpha.70
[1.0.0-alpha.69]: https://github.com/shellicar/claude-cli/releases/tag/1.0.0-alpha.69
[1.0.0-alpha.68]: https://github.com/shellicar/claude-cli/releases/tag/1.0.0-alpha.68
[1.0.0-alpha.67]: https://github.com/shellicar/claude-cli/releases/tag/1.0.0-alpha.67
