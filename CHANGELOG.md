# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
