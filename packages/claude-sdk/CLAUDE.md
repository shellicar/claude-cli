# @shellicar/claude-sdk

## Architecture

SDK package providing bidirectional communication between an AI agent and a consumer application via `MessagePort`.

**Public API** (`src/public/`):

| File | Role |
|------|------|
| `createAnthropicAgent.ts` | Factory function, returns `IAnthropicAgent` |
| `interfaces.ts` | `IAnthropicAgent` abstract class |
| `types.ts` | `RunAgentQuery`, `RunAgentResult`, `SdkMessage`, `ConsumerMessage`, etc. |
| `enums.ts` | `AnthropicBeta` feature flags |

**Private internals** (`src/private/`):

| File | Role |
|------|------|
| `AnthropicAgent.ts` | Implements `IAnthropicAgent`, creates `AgentRun` per query |
| `AgentRun.ts` | Drives the message loop, tool handling, approval flow |
| `AgentChannel.ts` | `MessageChannel` wrapper, exposes `consumerPort` to caller |
| `ApprovalState.ts` | Tracks pending tool approval promises, handles cancel |
| `MessageStream.ts` | Processes the Anthropic streaming API response |
| `types.ts` | Internal types (`ToolUseResult`, `ApprovalResponse`) |
| `consts.ts` | `AGENT_SDK_PREFIX` system prompt prefix |

## Communication Model

`runAgent()` returns a `RunAgentResult`:
- `port: MessagePort`: the consumer end of the channel
- `done: Promise<void>`: resolves when the agent finishes or errors

**SDK to consumer** (`SdkMessage`):
- `message_start` / `message_text` / `message_end`: streaming text chunks
- `tool_approval_request`: asks consumer to approve a tool call (includes `requestId`, `name`, `input`)
- `done`: agent finished normally
- `error`: agent encountered an error

**Consumer to SDK** (`ConsumerMessage`):
- `tool_approval_response`: approve or reject a pending tool call (matched by `requestId`)
- `cancel`: cancel the run

## Tool Handling Flow

For each set of tool uses returned by the model:

1. **Resolve**: Find each tool by name in `options.tools`. Error immediately for missing tools.
2. **Validate**: Run `tool.input_schema.safeParse(input)`. Error immediately for invalid input.
3. **Approve** (if `requireToolApproval`): Send all approval requests to the consumer at once, then execute tools in the order approvals arrive.
4. **Execute**: Call `tool.handler(validatedInput, store)`.

Steps 1 and 2 happen before any approval requests are sent, so the consumer is never asked about a tool that would fail anyway.

