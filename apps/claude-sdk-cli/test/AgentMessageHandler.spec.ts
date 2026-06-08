import { type AnyToolDefinition, CacheTtl, type ConsumerMessage, type DurableConfig, type IPublisher } from '@shellicar/claude-sdk';
import { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentMessageHandler, type AgentMessageHandlerOptions } from '../src/controller/AgentMessageHandler.js';
import { logger } from '../src/logger.js';
import { ApprovalNotifier } from '../src/model/ApprovalNotifier.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { IProcessLauncher } from '../src/model/IProcessLauncher.js';
import { StatusState } from '../src/model/StatusState.js';
import { ToolApprovalState } from '../src/model/ToolApprovalState.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

class NoopLauncher extends IProcessLauncher {
  public launch(): void {}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeConfig(overrides: Partial<DurableConfig> = {}): DurableConfig {
  return {
    model: 'claude-test' as DurableConfig['model'],
    maxTokens: 1024,
    tools: [],
    cacheTtl: CacheTtl.FiveMinutes,
    ...overrides,
  };
}

type OptsOverrides = {
  config?: Partial<DurableConfig>;
  cwd?: string;
  store?: RefStore;
  statusState?: StatusState;
  conversationState?: ConversationState;
  toolApprovalState?: ToolApprovalState;
};

function makeOpts(overrides: OptsOverrides): AgentMessageHandlerOptions {
  return {
    config: makeConfig(overrides.config),
    channel: {
      send: () => {},
      close: () => {},
      drain: () => Promise.resolve(),
    } satisfies IPublisher<ConsumerMessage>,
    cwd: overrides.cwd ?? '/test',
    store: overrides.store ?? new RefStore(),
    statusState: overrides.statusState ?? new StatusState(new MemoryFileSystem({}, '/home/user', '/test')),
    notifier: new ApprovalNotifier(null, new NoopLauncher()),
    conversationState: overrides.conversationState ?? new ConversationState(),
    toolApprovalState: overrides.toolApprovalState ?? new ToolApprovalState(),
  };
}

function makeHandler(overrides: OptsOverrides = {}) {
  const conversationState = overrides.conversationState ?? new ConversationState();
  const toolApprovalState = overrides.toolApprovalState ?? new ToolApprovalState();
  const statusState = overrides.statusState ?? new StatusState(new MemoryFileSystem({}, '/home/user', '/test'));
  const handler = new AgentMessageHandler(logger, makeOpts({ ...overrides, conversationState, toolApprovalState, statusState }));
  return { handler, conversationState, toolApprovalState, statusState };
}

/** Fire tool_use_start + tool_use_input_stop to put a client tool in the ToolObject list. */
function streamTool(handler: AgentMessageHandler, id: string, name: string): void {
  handler.handle({ type: 'tool_use_start', id, name });
  handler.handle({ type: 'tool_use_input_stop', id });
}

/** Find the most recent tools block content (active first, then last sealed). */
function toolsBlockContent(state: ConversationState): string {
  if (state.activeBlock?.type === 'tools') {
    return state.activeBlock.content;
  }
  const sealed = [...state.sealedBlocks].reverse().find((b) => b.type === 'tools');
  return sealed?.content ?? '';
}

function makeTool(name: string, operation: AnyToolDefinition['operation']): AnyToolDefinition {
  return {
    name,
    description: 'test',
    operation,
    input_schema: z.object({}),
    output_schema: z.unknown(),
    input_examples: [],
    handler: async () => ({ textContent: undefined }),
  };
}

// ---------------------------------------------------------------------------
// query_summary
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — query_summary', () => {
  it('transitions to meta block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'query_summary', systemPrompts: 1, userMessages: 2, assistantMessages: 1, thinkingBlocks: 0 });
    const expected = 'meta';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('streams the model and parts joined by ·', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'query_summary', systemPrompts: 1, userMessages: 2, assistantMessages: 1, thinkingBlocks: 0 });
    const expected = '\uD83E\uDD16 claude-test\n1 system \u00b7 2 user \u00b7 1 assistant';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('uses the configured model name in the streamed line', () => {
    const { handler, conversationState } = makeHandler({ config: { model: 'claude-opus-4-1' as DurableConfig['model'] } });
    handler.handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 1, thinkingBlocks: 0 });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('claude-opus-4-1') ?? false;
    expect(actual).toBe(expected);
  });

  it('includes thinking block count when non-zero', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 1, thinkingBlocks: 3 });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('3 thinking') ?? false;
    expect(actual).toBe(expected);
  });

  it('omits thinking count when zero', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 1, thinkingBlocks: 0 });
    const expected = false;
    const actual = conversationState.activeBlock?.content.includes('thinking') ?? false;
    expect(actual).toBe(expected);
  });

  it('appends systemReminder on a new line when set', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 1, thinkingBlocks: 0, systemReminder: '[git delta] untracked: +1' });
    const expected = '\uD83E\uDD16 claude-test\n1 system \u00b7 1 user \u00b7 1 assistant\n[git delta] untracked: +1';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('streamed line ends at stats when systemReminder is absent', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 1, thinkingBlocks: 0 });
    const expected = '\uD83E\uDD16 claude-test\n1 system \u00b7 1 user \u00b7 1 assistant';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_thinking
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — message_thinking', () => {
  it('transitions to thinking block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'message_thinking', text: 'hmm' });
    const expected = 'thinking';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('streams the thinking text', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'message_thinking', text: 'hmm' });
    const expected = 'hmm';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_text
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — message_text', () => {
  it('transitions to response block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'message_text', text: 'hello' });
    const expected = 'response';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('streams the text', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'message_text', text: 'hello' });
    const expected = 'hello';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_compaction_start
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — message_compaction_start', () => {
  it('transitions to compaction block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'message_compaction_start' });
    const expected = 'compaction';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('does not stream any text', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'message_compaction_start' });
    const expected = '';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_compaction
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — message_compaction', () => {
  it('transitions to compaction block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'message_compaction', summary: 'context trimmed' });
    const expected = 'compaction';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('streams the summary', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'message_compaction', summary: 'context trimmed' });
    const expected = 'context trimmed';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// done
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — done', () => {
  it('does not append to the active block on end_turn', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'message_text', text: 'hi' });
    handler.handle({ type: 'done', stopReason: 'end_turn' });
    const expected = 'hi';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('streams a stop annotation for non-end_turn reasons', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'message_text', text: 'hi' });
    handler.handle({ type: 'done', stopReason: 'max_tokens' });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('[stop: max_tokens]') ?? false;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// error
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — error', () => {
  it('does not transition to a new block', () => {
    const { handler, conversationState } = makeHandler();
    conversationState.transitionBlock('meta');
    handler.handle({ type: 'error', message: 'oops' });
    const expected = 'meta';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('streams an error annotation into the active block', () => {
    const { handler, conversationState } = makeHandler();
    conversationState.transitionBlock('meta');
    handler.handle({ type: 'error', message: 'oops' });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('[error: oops]') ?? false;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// tool_error
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — tool_error', () => {
  it('transitions to tools block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_error', name: 'EditFile', input: { file: 'x.ts' }, error: 'oops' });
    const expected = 'tools';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('streams tool name in the error line', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_error', name: 'EditFile', input: { file: 'x.ts' }, error: 'boom' });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('EditFile error') ?? false;
    expect(actual).toBe(expected);
  });

  it('includes the error message in the output', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_error', name: 'EditFile', input: { file: 'x.ts' }, error: 'bad things' });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('bad things') ?? false;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// tool_use_start
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — tool_use_start', () => {
  it('transitions to tools block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_use_start', id: 'toolu_01', name: 'ReadFile' });
    const expected = 'tools';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('sets the block content to the tool name on start', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_use_start', id: 'toolu_01', name: 'ReadFile' });
    const expected = 'ReadFile';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('snapshots usageBeforeTools so the next message_usage produces a delta annotation', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
    handler.handle({ type: 'tool_use_start', id: 'toolu_01', name: 'ReadFile' });
    handler.handle(makeUsage(1500));
    const expected = true;
    const actual = toolsBlockContent(conversationState).includes('+500');
    expect(actual).toBe(expected);
  });

  it('includes both tool names in the content after a second tool starts', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_use_start', id: 'toolu_01', name: 'ReadFile' });
    handler.handle({ type: 'tool_use_input_stop', id: 'toolu_01' });
    handler.handle({ type: 'tool_use_start', id: 'toolu_02', name: 'WriteFile' });
    // tool1 is 'streamed' (trailing \n), tool2 is 'streaming' (no \n)
    const expected = 'ReadFile\nWriteFile';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// server_tool_use_start
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — server_tool_use_start', () => {
  it('transitions to tools block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'server_tool_use_start', id: 'srvtoolu_01', name: 'web_search' });
    const expected = 'tools';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('sets the block content to the server-tool prefix and name on start', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'server_tool_use_start', id: 'srvtoolu_01', name: 'web_search' });
    const expected = '\uD83C\uDF10 web_search';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// server_tool_use
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — server_tool_use', () => {
  it('resolves to the formatted summary, renders pending phase with trailing newline', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'server_tool_use_start', id: 'srvtoolu_01', name: 'web_search' });
    handler.handle({ type: 'server_tool_use', id: 'srvtoolu_01', name: 'web_search', input: { query: 'test' } });
    const expected = '\uD83C\uDF10 web_search(test)\n';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// server_tool_result
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — server_tool_result', () => {
  it('renders the done phase with ✅', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'server_tool_use_start', id: 'srvtoolu_01', name: 'web_search' });
    handler.handle({ type: 'server_tool_use', id: 'srvtoolu_01', name: 'web_search', input: { query: 'test' } });
    handler.handle({ type: 'server_tool_result', id: 'srvtoolu_01', name: 'web_search', result: {} });
    const expected = '\uD83C\uDF10 web_search(test) \u2705\n';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// tool_use_input_delta
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — tool_use_input_delta', () => {
  it('streams the partial JSON appended to the tool name', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_use_start', id: 'toolu_01', name: 'ReadFile' });
    handler.handle({ type: 'tool_use_input_delta', id: 'toolu_01', partialJson: '{"path":"/foo' });
    // streaming phase: name + partialInput, no trailing \n
    const expected = 'ReadFile{"path":"/foo';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('does not transition the block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_use_start', id: 'toolu_01', name: 'ReadFile' });
    handler.handle({ type: 'tool_use_input_delta', id: 'toolu_01', partialJson: '{"path":"/foo' });
    const expected = 'tools';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// tool_use_input_stop
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — tool_use_input_stop', () => {
  it('appends a newline after the streaming content', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_use_start', id: 'toolu_01', name: 'ReadFile' });
    handler.handle({ type: 'tool_use_input_delta', id: 'toolu_01', partialJson: '{"path":"/foo"}' });
    handler.handle({ type: 'tool_use_input_stop', id: 'toolu_01' });
    // streamed phase: name + partialInput + \n
    const expected = 'ReadFile{"path":"/foo"}\n';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// tool_approval_request
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — tool_approval_request', () => {
  it('transitions to tools block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Unknown', input: {} });
    const expected = 'tools';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('renders the resolved view synchronously before any approval work', () => {
    const toolApprovalState = new ToolApprovalState();
    // Hold the approval open so we can inspect phase-3 state synchronously
    const neverResolves = new Promise<boolean>(() => {});
    toolApprovalState.requestApproval = () => neverResolves;
    const { handler, conversationState } = makeHandler({
      config: { tools: [makeTool('DeleteFile', 'delete')] },
      toolApprovalState,
    });
    streamTool(handler, 'toolu_01', 'DeleteFile');
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_01', name: 'DeleteFile', input: {} });
    // pending phase: formatToolSummary('DeleteFile', {}) → 'DeleteFile'; render → 'DeleteFile\n'
    const expected = 'DeleteFile\n';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('records auto-denied status for an unknown tool', () => {
    const { handler, conversationState } = makeHandler();
    streamTool(handler, 'toolu_01', 'Unknown');
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_01', name: 'Unknown', input: {} });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('\u274C') ?? false;
    expect(actual).toBe(expected);
  });

  it('records auto-approved status for a read tool', () => {
    const { handler, conversationState } = makeHandler({ config: { tools: [makeTool('Find', 'read')] } });
    streamTool(handler, 'toolu_01', 'Find');
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_01', name: 'Find', input: {} });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('\u2705') ?? false;
    expect(actual).toBe(expected);
  });

  it('records manual approval after user input for a delete tool', async () => {
    const toolApprovalState = new ToolApprovalState();
    const { handler, conversationState } = makeHandler({
      config: { tools: [makeTool('DeleteFile', 'delete')] },
      toolApprovalState,
    });
    streamTool(handler, 'toolu_01', 'DeleteFile');
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_01', name: 'DeleteFile', input: {} });
    toolApprovalState.resolveNextApproval(true);
    await flush();
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('\u2705') ?? false;
    expect(actual).toBe(expected);
  });

  it('records manual denial after user input for a delete tool', async () => {
    const toolApprovalState = new ToolApprovalState();
    const { handler, conversationState } = makeHandler({
      config: { tools: [makeTool('DeleteFile', 'delete')] },
      toolApprovalState,
    });
    streamTool(handler, 'toolu_01', 'DeleteFile');
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_01', name: 'DeleteFile', input: {} });
    toolApprovalState.resolveNextApproval(false);
    await flush();
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('\u274C') ?? false;
    expect(actual).toBe(expected);
  });

  it('renders all pending tools simultaneously while manual approval is awaited', () => {
    const toolApprovalState = new ToolApprovalState();
    const neverResolves = new Promise<boolean>(() => {});
    toolApprovalState.requestApproval = () => neverResolves;
    const { handler, conversationState } = makeHandler({
      config: { tools: [makeTool('DeleteFile', 'delete')] },
      toolApprovalState,
    });
    streamTool(handler, 'toolu_01', 'DeleteFile');
    streamTool(handler, 'toolu_02', 'DeleteFile');
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_01', name: 'DeleteFile', input: {} });
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_02', name: 'DeleteFile', input: {} });
    // both in 'pending' phase
    const expected = 'DeleteFile\nDeleteFile\n';
    const actual = conversationState.activeBlock?.content ?? '';
    expect(actual).toBe(expected);
  });

  it('shows both tools approved after both auto-approvals complete', () => {
    const { handler, conversationState } = makeHandler({
      config: { tools: [makeTool('Find', 'read'), makeTool('ReadFile', 'read')] },
    });
    streamTool(handler, 'toolu_01', 'Find');
    streamTool(handler, 'toolu_02', 'ReadFile');
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_01', name: 'Find', input: {} });
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_02', name: 'ReadFile', input: {} });
    const expected = 'Find \u2705\nReadFile \u2705\n';
    const actual = conversationState.activeBlock?.content ?? '';
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_usage
// ---------------------------------------------------------------------------

function makeUsage(inputTokens: number): { type: 'message_usage'; inputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; outputTokens: number; costUsd: number; contextWindow: number } {
  return { type: 'message_usage', inputTokens, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 100, costUsd: 0.001, contextWindow: 200_000 };
}

describe('AgentMessageHandler — message_usage without prior tools', () => {
  it('updates usage on the status state', () => {
    const { handler, statusState } = makeHandler();
    handler.handle(makeUsage(1000));
    const expected = 1000;
    const actual = statusState.totalInputTokens;
    expect(actual).toBe(expected);
  });

  it('does not create a block when no tool batch is open', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
    const expected = null;
    const actual = conversationState.activeBlock;
    expect(actual).toBe(expected);
  });
});

describe('AgentMessageHandler — message_usage delta annotation', () => {
  it('annotates the tools block with token delta after a tool batch', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1500));
    const expected = true;
    const actual = toolsBlockContent(conversationState).includes('+500');
    expect(actual).toBe(expected);
  });

  it('second independent batch produces its own annotation', () => {
    // message_usage seals the prior batch's tools block — no message_text needed.
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
    streamTool(handler, 'r1', 'Find');
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1500));
    streamTool(handler, 'r2', 'Find');
    handler.handle({ type: 'tool_approval_request', requestId: 'r2', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1700));
    const expected = true;
    const actual = toolsBlockContent(conversationState).includes('+200');
    expect(actual).toBe(expected);
  });

  it('computes the second batch delta from the post-first-batch usage', () => {
    // The +200 (not +700) confirms usageBeforeTools reset to lastUsage=1500 after batch 1.
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
    streamTool(handler, 'r1', 'Find');
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1500));
    streamTool(handler, 'r2', 'Find');
    handler.handle({ type: 'tool_approval_request', requestId: 'r2', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1700));
    const expected = true;
    const actual = toolsBlockContent(conversationState).includes('+200');
    expect(actual).toBe(expected);
  });

  it('first batch annotation survives second batch starting without text between', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
    streamTool(handler, 'r1', 'Find');
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1500)); // seals batch-1 block; no message_text
    streamTool(handler, 'r2', 'Find');
    // batch-2 redraw must not overwrite batch-1's sealed annotation
    const expected = true;
    const actual = conversationState.sealedBlocks.some((b) => b.type === 'tools' && b.content.includes('+500'));
    expect(actual).toBe(expected);
  });

  it('does not re-snapshot usage when a batch is already open', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
    // Two tools in the same batch before usage arrives
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    handler.handle({ type: 'tool_approval_request', requestId: 'r2', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1800));
    const expected = true;
    const actual = toolsBlockContent(conversationState).includes('+800');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_compaction with lastUsage
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — message_compaction annotation', () => {
  it('appends context-usage annotation when lastUsage is known', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(150_000));
    handler.handle({ type: 'message_compaction', summary: 'trimmed' });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('compacted at') ?? false;
    expect(actual).toBe(expected);
  });

  it('omits annotation when lastUsage is not yet known', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'message_compaction', summary: 'trimmed' });
    const expected = false;
    const actual = conversationState.activeBlock?.content.includes('compacted at') ?? false;
    expect(actual).toBe(expected);
  });
});
