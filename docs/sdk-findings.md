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

## Session Resume

### `Options.resume` vs `Options.sessionId`

These are two distinct fields with different purposes:

| Field | Purpose |
|-------|---------|
| `resume?: string` | Resume an existing session by ID. Loads conversation history. |
| `sessionId?: string` | Assign a custom UUID to a **new** session instead of letting the SDK auto-generate one. |
| `continue?: boolean` | Resume the most recent session in the current directory. Mutually exclusive with `resume`. |

`sessionId` is not for resumption — it cannot be used with `resume` unless `forkSession: true` is also set (in which case it assigns a custom ID to the forked session). The current CLI usage of `resume: this.sessionId` is correct.

### Resume Notification

There is no dedicated "resume notification" message. `SDKSystemMessage` has exactly one subtype: `init`. It fires at the start of every query — both new and resumed.

To detect whether a resume succeeded: compare `init.session_id` with the value passed to `Options.resume`. If they match, the session was successfully resumed. If they differ, the SDK started a new session (e.g., because the session ID was not found).

The current CLI commits the session ID to `this.sessionId` immediately on `init` (`this.sessionId = msg.session_id`). This works for both new sessions and resumes, and re-captures a new ID if the resume silently fails. Committing on `init` (rather than on `result`) ensures the session ID is preserved even if the query is aborted before a `result` message arrives.

### `session_id` on `SDKUserMessage`

`SDKUserMessage.session_id` is a **required** `string` field. When `buildPrompt()` returns an `AsyncIterable<SDKUserMessage>` (i.e., when attachments are present), each yielded message must include a `session_id`.

The current code uses `session_id: this.sessionId ?? ''`:

- **Resumed queries**: correct — `this.sessionId` holds the previous session's ID, matching `Options.resume`.
- **First query with attachments**: passes `''` — the session ID is unknown at prompt-build time because the `init` message hasn't fired yet. This is not redundant with `Options.resume`; the SDK uses it to route the streaming message to the correct session. Passing `''` appears tolerated in practice but is technically incorrect.

**Potential improvement**: For new sessions, `session_id` on the user message cannot be known ahead of time (it's assigned by the SDK). The empty string workaround is the only option unless the SDK adds a way to pre-assign IDs — which `Options.sessionId` could theoretically enable, but the `session_id` field would need to be set consistently.

### `resumeSessionAt`

`resumeSessionAt?: string` resumes only up to and including a specific message by UUID (from `SDKAssistantMessage.uuid`). Use with `resume` to resume from a specific point in a conversation. The CLI already wires this through: `this.resumeAt ? { resumeSessionAt: this.resumeAt } : {}`.

## Background Tasks

When Claude runs `run_in_background: true`, the task may complete after the query's `result` message. The SDK emits a `task_notification` and starts a new internal turn, but the original `canUseTool` handler may be stale.

**Symptom**: `Error: Stream closed` on repeated tool permission requests.

**Mitigations**: Guard in `canUseTool` checks `session.isActive`, and `PermissionManager.resolve()` checks abort signal before creating waiters.
