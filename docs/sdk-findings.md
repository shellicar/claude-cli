# SDK Findings

Discoveries about the boundary between the Claude Agent SDK and the official CLI.

## `settingSources` Option

Adding `settingSources: ['local', 'project', 'user']` to SDK options enables:

- Skills loaded and invokable (git-commit, github-pr, etc.)
- `PreToolUse` hooks firing (block_dangerous_commands.sh)
- Settings.json being read
- File change notifications (system reminders)
- `permissions.deny` rules — removes tools entirely with explicit error
- Plugins loaded (typescript-lsp, agent-sdk-dev confirmed in audit)

**Not loaded by default** — skills, hooks, plugins, file change notifications all require `settingSources`.

## SDK Options

Key options from `sdk.d.ts`:

| Option | Description |
|--------|-------------|
| `permissionMode` | `'acceptEdits'`, `'dontAsk'`, `'bypassPermissions'`, etc. |
| `allowedTools` | Array of tool names that auto-allow without prompting |
| `disallowedTools` | Array of tool names to remove from model context entirely |
| `tools` | Whitelist — ONLY these tools exist (restricts available tools) |
| `includePartialMessages` | Emits streaming events for activity indicators |
| `stderr` | Callback for capturing SDK process errors |
| `systemPrompt` | Supports `{ type: 'preset', preset: 'claude_code', append: '...' }` |
| `hooks` | Programmatic hook callbacks |
| `agents` | Define custom subagents for the Task tool |
| `plugins` | `[{ type: 'local', path: './my-plugin' }]` |
| `debug` / `debugFile` | Built-in debug logging |
| `enableFileCheckpointing` | Track and rewind file changes |
| `thinking` | `{ type: 'adaptive' }` for Opus 4.6 adaptive thinking |
| `effort` | `'low'` / `'medium'` / `'high'` / `'max'` thinking depth |
| `maxBudgetUsd` | Cost cap per query |
| `betas` | `'context-1m-2025-08-07'` for 1M context (Sonnet 4/4.5) |

## Tool Options Distinction

- `allowedTools: ['Edit']` — Edit auto-approves without prompting (all tools still available)
- `tools: ['Bash', 'Read']` — whitelist: ONLY Bash and Read exist
- `tools: []` — Claude sees tools in system prompt but cannot call any (silent failure)
- `disallowedTools: ['Bash']` — removes from model context entirely

## `AskUserQuestion` Tool

- `allowedTools` has **no effect** — always goes through `canUseTool`
- Without a handler, hits the raw permission prompt
- Denying returns `"User denied"` as the tool result
- Approving without a handler returns an empty response

## `defaultMode` from Settings

`permissionMode` must be passed explicitly in SDK options. The SDK does not read `defaultMode` from settings.json.

## Additional Directories

The official CLI supports `/add-dir` via the `additionalDirectories` option on each `query()` call.

Persistence: stored in `<cwd>/.claude/settings.local.json` under `permissions.additionalDirectories`. Written atomically via temp file + rename.

## Background Tasks

When Claude runs `run_in_background: true`, the task may complete after the query's `result` message. The SDK emits a `task_notification` and starts a new internal turn, but the original `canUseTool` handler may be stale.

**Symptom**: `Error: Stream closed` on repeated tool permission requests.

**Mitigations**: Guard in `canUseTool` checks `session.isActive`, and `PermissionManager.resolve()` checks abort signal before creating waiters.
