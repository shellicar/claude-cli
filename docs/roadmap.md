# Roadmap

Tracking toward the **1.0.0** milestone.

## In Progress

### Command Mode Menu

Hierarchical key menus (vim/roguelikes style). `Ctrl+/` enters command mode, keys navigate submenus, `Esc` goes back.

Proposed layout:

- **Top-level (flat)**: `i`=image, `t`=text, `f`=file paths, `d`=delete, `p`=preview, `←→`=navigate attachments
- `s` = Session submenu (`c`=compact, `s`=show, `r`=resume-at)
- `k` = sKills (type-to-filter with autocomplete)
- `a` = Add directory
- `c` = Config
- `v` = Version
- `h` = Help
- `q` = Quit

### Monorepo Setup

Move to a monorepo structure.

## Planned

### Core Features

- Configurable auto-compact threshold
- Capture SDK stderr for real error messages
- `multiSelect` mode for AskUserQuestion

### Bash Safety

Normalise → Match → Decide flow for Bash commands:

1. **Normalise** — resolve cwd-override flags before matching
2. **Match** against green (auto-approve), red (auto-deny), yellow (prompt) tiers
3. **Chain detection** — split `&&`/`||`/`;`/`|` and match each part

### Skill-Aware Auto-Approve

When a skill workflow is active, user decisions via `AskUserQuestion` auto-approve subsequent matching tool calls — building a trust chain from user intent through to execution.

### System Prompt Providers

- Configurable context thresholds with multiple tiers
- Runtime toggling (`/toggle git`)
- Provider latency tracking
- `NodeProvider`, `EnvProvider`
- User-configurable custom providers

### Stream Events

- Activity indicators from streaming deltas
- System status display (compacting, init, etc.)
- Streaming text preview
- Mid-response cost updates

### Smart Auto-Compact

Automatic compaction at configurable threshold with modes: default, custom prompt, Claude-generated prompt.

### Terminal Rendering

- Zone-based rendering with fixed status/prompt area
- Multi-line paste support
- Escape during permission prompt handling

### Input & UX

- Type-ahead while Claude is responding
- Message queueing
- Tmux pane title integration
- Skill mode with type-to-filter autocomplete
- Multiple editors / tabs

### Paste from File

Read file paths from clipboard. PowerShell `GetFileDropList()` works from WSL2 (returns UNC paths for WSL files, Windows paths for `C:\`). On native Linux/macOS, `text/uri-list` MIME type.

### Session Dashboard

Central view of all Claude sessions across projects — list, filter, search, quick switch, health monitoring.

## Known Bugs

- **Cursor off by 1 line** — occasional mismatch between calculated `stickyLineCount` and actual rendered lines. No reliable repro.
- **Permission prompt readability** — tool permission prompts output raw JSON most of the time. Only plan mode prompts are formatted.
