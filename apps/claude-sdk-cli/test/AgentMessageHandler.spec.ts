import type { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { type AnyToolDefinition, CacheTtl, type ConsumerMessage, type DurableConfig, type IPublisher } from '@shellicar/claude-sdk';
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
  store?: AgentMessageHandlerOptions['store'];
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
    store: overrides.store ?? ({ get: () => undefined, getHint: () => undefined } as unknown as AgentMessageHandlerOptions['store']),
    statusState: overrides.statusState ?? new StatusState(new MemoryFileSystem({}, '/home/user', '/test')),
    notifier: new ApprovalNotifier(
      {
        get config() {
          return { hooks: { approvalNotify: null } } as any;
        },
      } as unknown as ConfigLoader<any>,
      new NoopLauncher(),
    ),
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

/** The token-delta annotation lands on the tools block, whether still active or already sealed. */
function toolsBlockContent(state: ConversationState): string {
  if (state.activeBlock?.type === 'tools') {
    return state.activeBlock.content;
  }
  const sealed = [...state.sealedBlocks].reverse().find((b) => b.type === 'tools');
  return sealed?.content ?? '';
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
  it('transitions to response block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'error', message: 'oops' });
    const expected = 'response';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('streams an error annotation', () => {
    const { handler, conversationState } = makeHandler();
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
// tool_approval_request
// ---------------------------------------------------------------------------

function makeTool(name: string, operation: AnyToolDefinition['operation']): AnyToolDefinition {
  return {
    name,
    description: 'test',
    operation,
    input_schema: z.object({}),
    input_examples: [],
    handler: async () => ({}),
  } as unknown as AnyToolDefinition;
}

describe('AgentMessageHandler — tool_approval_request', () => {
  it('transitions to tools block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Unknown', input: {} });
    const expected = 'tools';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('records auto-denied decision when tool is not registered', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Unknown', input: {} });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('❌') ?? false;
    expect(actual).toBe(expected);
  });

  it('records auto-approved decision for a read tool', () => {
    const { handler, conversationState } = makeHandler({ config: { tools: [makeTool('Find', 'read')] } });
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: {} });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('✅') ?? false;
    expect(actual).toBe(expected);
  });

  it('records manual approval after user input for a delete tool', async () => {
    const { handler, conversationState, toolApprovalState } = makeHandler({ config: { tools: [makeTool('DeleteFile', 'delete')] } });
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'DeleteFile', input: {} });
    toolApprovalState.resolveNextApproval(true);
    await flush();
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('✅') ?? false;
    expect(actual).toBe(expected);
  });

  it('records manual denial after user input for a delete tool', async () => {
    const { handler, conversationState, toolApprovalState } = makeHandler({ config: { tools: [makeTool('DeleteFile', 'delete')] } });
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'DeleteFile', input: {} });
    toolApprovalState.resolveNextApproval(false);
    await flush();
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('❌') ?? false;
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

  it('produces two annotations across two independent tool batches', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1500));
    handler.handle({ type: 'tool_approval_request', requestId: 'r2', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1700));
    const expected = 2;
    const actual = toolsBlockContent(conversationState).split('\u2191').length - 1;
    expect(actual).toBe(expected);
  });

  it('computes the second batch delta from the post-first-batch usage', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1500));
    handler.handle({ type: 'tool_approval_request', requestId: 'r2', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1700));
    const expected = true;
    const actual = toolsBlockContent(conversationState).includes('+200');
    expect(actual).toBe(expected);
  });

  it('does not re-snapshot usage when a batch is already open', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
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
