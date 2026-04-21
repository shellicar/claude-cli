import { MessageChannel } from 'node:worker_threads';
import { type AnyToolDefinition, CacheTtl, type DurableConfig } from '@shellicar/claude-sdk';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AppLayout } from '../src/AppLayout.js';
import { AgentMessageHandler, type AgentMessageHandlerOptions } from '../src/controller/AgentMessageHandler.js';
import { logger } from '../src/logger.js';
import { ApprovalNotifier } from '../src/model/ApprovalNotifier.js';
import { IProcessLauncher } from '../src/model/IProcessLauncher.js';
import { StatusState } from '../src/model/StatusState.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

class NoopLauncher extends IProcessLauncher {
  public launch(): void {}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLayout() {
  return {
    transitionBlock: vi.fn(),
    appendStreaming: vi.fn(),
    appendToLastSealed: vi.fn(),
    addPendingTool: vi.fn(),
    removePendingTool: vi.fn(),
    requestApproval: vi.fn().mockResolvedValue(true),
  } as unknown as AppLayout;
}

function makeConfig(overrides: Partial<DurableConfig> = {}): DurableConfig {
  return {
    model: 'claude-test' as DurableConfig['model'],
    maxTokens: 1024,
    tools: [],
    cacheTtl: CacheTtl.FiveMinutes,
    ...overrides,
  };
}

function makeOpts(overrides: { config?: Partial<DurableConfig>; cwd?: string; store?: AgentMessageHandlerOptions['store']; statusState?: StatusState } = {}): AgentMessageHandlerOptions {
  return {
    config: makeConfig(overrides.config),
    port: new MessageChannel().port2,
    cwd: overrides.cwd ?? '/test',
    store: overrides.store ?? ({ get: vi.fn(), getHint: vi.fn() } as unknown as AgentMessageHandlerOptions['store']),
    statusState: overrides.statusState ?? new StatusState(new MemoryFileSystem({}, '/home/user', '/test')),
    notifier: new ApprovalNotifier(null, new NoopLauncher()),
  };
}

function makeHandler(layout: AppLayout, opts?: Parameters<typeof makeOpts>[0]) {
  return new AgentMessageHandler(layout, logger, makeOpts(opts));
}

// ---------------------------------------------------------------------------
// query_summary
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — query_summary', () => {
  it('transitions to meta block', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'query_summary', systemPrompts: 1, userMessages: 2, assistantMessages: 1, thinkingBlocks: 0 });
    const expected = 'meta';
    const actual = vi.mocked(layout.transitionBlock).mock.calls[0]?.[0];
    expect(actual).toBe(expected);
  });

  it('streams the model and parts joined by ·', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'query_summary', systemPrompts: 1, userMessages: 2, assistantMessages: 1, thinkingBlocks: 0 });
    const expected = '\uD83E\uDD16 claude-test\n1 system · 2 user · 1 assistant';
    const actual = vi.mocked(layout.appendStreaming).mock.calls[0]?.[0];
    expect(actual).toBe(expected);
  });

  it('uses the configured model name in the streamed line', () => {
    const layout = makeLayout();
    makeHandler(layout, { config: { model: 'claude-opus-4-1' as DurableConfig['model'] } }).handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 1, thinkingBlocks: 0 });
    const expected = true;
    const actual = (vi.mocked(layout.appendStreaming).mock.calls[0]?.[0] ?? '').includes('claude-opus-4-1');
    expect(actual).toBe(expected);
  });

  it('includes thinking block count when non-zero', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 1, thinkingBlocks: 3 });
    const expected = true;
    const actual = (vi.mocked(layout.appendStreaming).mock.calls[0]?.[0] ?? '').includes('3 thinking');
    expect(actual).toBe(expected);
  });

  it('omits thinking count when zero', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 1, thinkingBlocks: 0 });
    const expected = false;
    const actual = (vi.mocked(layout.appendStreaming).mock.calls[0]?.[0] ?? '').includes('thinking');
    expect(actual).toBe(expected);
  });

  it('appends systemReminder on a new line when set', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 1, thinkingBlocks: 0, systemReminder: '[git delta] untracked: +1' });
    const actual = vi.mocked(layout.appendStreaming).mock.calls[0]?.[0];
    const expected = '\uD83E\uDD16 claude-test\n1 system \u00b7 1 user \u00b7 1 assistant\n[git delta] untracked: +1';
    expect(actual).toBe(expected);
  });

  it('streamed line ends at stats when systemReminder is absent', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 1, thinkingBlocks: 0 });
    const actual = vi.mocked(layout.appendStreaming).mock.calls[0]?.[0];
    const expected = '\uD83E\uDD16 claude-test\n1 system \u00b7 1 user \u00b7 1 assistant';
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_thinking
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — message_thinking', () => {
  it('transitions to thinking block', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'message_thinking', text: 'hmm' });
    const expected = 'thinking';
    const actual = vi.mocked(layout.transitionBlock).mock.calls[0]?.[0];
    expect(actual).toBe(expected);
  });

  it('streams the thinking text', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'message_thinking', text: 'hmm' });
    const expected = 'hmm';
    const actual = vi.mocked(layout.appendStreaming).mock.calls[0]?.[0];
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_text
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — message_text', () => {
  it('transitions to response block', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'message_text', text: 'hello' });
    const expected = 'response';
    const actual = vi.mocked(layout.transitionBlock).mock.calls[0]?.[0];
    expect(actual).toBe(expected);
  });

  it('streams the text', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'message_text', text: 'hello' });
    const expected = 'hello';
    const actual = vi.mocked(layout.appendStreaming).mock.calls[0]?.[0];
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_compaction_start
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — message_compaction_start', () => {
  it('transitions to compaction block', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'message_compaction_start' });
    const expected = 'compaction';
    const actual = vi.mocked(layout.transitionBlock).mock.calls[0]?.[0];
    expect(actual).toBe(expected);
  });

  it('does not stream any text', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'message_compaction_start' });
    const expected = 0;
    const actual = vi.mocked(layout.appendStreaming).mock.calls.length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_compaction
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — message_compaction', () => {
  it('transitions to compaction block', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'message_compaction', summary: 'context trimmed' });
    const expected = 'compaction';
    const actual = vi.mocked(layout.transitionBlock).mock.calls[0]?.[0];
    expect(actual).toBe(expected);
  });

  it('streams the summary', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'message_compaction', summary: 'context trimmed' });
    const expected = 'context trimmed';
    const actual = vi.mocked(layout.appendStreaming).mock.calls[0]?.[0];
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// done
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — done', () => {
  it('does not stream anything on end_turn', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'done', stopReason: 'end_turn' });
    const expected = 0;
    const actual = vi.mocked(layout.appendStreaming).mock.calls.length;
    expect(actual).toBe(expected);
  });

  it('streams a stop annotation for non-end_turn reasons', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'done', stopReason: 'max_tokens' });
    const expected = true;
    const actual = (vi.mocked(layout.appendStreaming).mock.calls[0]?.[0] ?? '').includes('[stop: max_tokens]');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// error
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — error', () => {
  it('transitions to response block', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'error', message: 'oops' });
    const expected = 'response';
    const actual = vi.mocked(layout.transitionBlock).mock.calls[0]?.[0];
    expect(actual).toBe(expected);
  });

  it('streams an error annotation', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'error', message: 'oops' });
    const expected = true;
    const actual = (vi.mocked(layout.appendStreaming).mock.calls[0]?.[0] ?? '').includes('[error: oops]');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// tool_error
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — tool_error', () => {
  it('transitions to tools block', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'tool_error', name: 'EditFile', input: { file: 'x.ts' }, error: 'oops' });
    const expected = 'tools';
    const actual = vi.mocked(layout.transitionBlock).mock.calls[0]?.[0];
    expect(actual).toBe(expected);
  });

  it('streams tool name in the error line', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'tool_error', name: 'EditFile', input: { file: 'x.ts' }, error: 'boom' });
    const expected = true;
    const actual = (vi.mocked(layout.appendStreaming).mock.calls[0]?.[0] ?? '').includes('EditFile error');
    expect(actual).toBe(expected);
  });

  it('includes the error message in the output', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'tool_error', name: 'EditFile', input: { file: 'x.ts' }, error: 'bad things' });
    const expected = true;
    const actual = (vi.mocked(layout.appendStreaming).mock.calls[0]?.[0] ?? '').includes('bad things');
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
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Unknown', input: {} });
    const expected = 'tools';
    const actual = vi.mocked(layout.transitionBlock).mock.calls[0]?.[0];
    expect(actual).toBe(expected);
  });

  it('records auto-denied decision synchronously when tool is not registered', () => {
    const layout = makeLayout();
    // empty tools → getPermission returns Deny for any unknown tool
    makeHandler(layout).handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Unknown', input: {} });
    const text = vi.mocked(layout.appendStreaming).mock.calls[0]?.[0] ?? '';
    expect(text).toContain('❌');
  });

  it('records auto-approved decision synchronously for a read tool', () => {
    const layout = makeLayout();
    const handler = makeHandler(layout, { config: { tools: [makeTool('Find', 'read')] } });
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: {} });
    const text = vi.mocked(layout.appendStreaming).mock.calls[0]?.[0] ?? '';
    expect(text).toContain('✅');
  });

  it('records manual approval after user input for a delete tool', async () => {
    const layout = makeLayout(); // requestApproval resolves true by default
    const handler = makeHandler(layout, { config: { tools: [makeTool('DeleteFile', 'delete')] } });
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'DeleteFile', input: {} });
    await Promise.resolve();
    const text = vi.mocked(layout.appendStreaming).mock.calls[0]?.[0] ?? '';
    expect(text).toContain('✅');
  });

  it('records manual denial after user input for a delete tool', async () => {
    const layout = makeLayout();
    vi.mocked(layout.requestApproval).mockResolvedValue(false);
    const handler = makeHandler(layout, { config: { tools: [makeTool('DeleteFile', 'delete')] } });
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'DeleteFile', input: {} });
    await Promise.resolve();
    const text = vi.mocked(layout.appendStreaming).mock.calls[0]?.[0] ?? '';
    expect(text).toContain('❌');
  });
});

// ---------------------------------------------------------------------------
// message_usage
// ---------------------------------------------------------------------------

function makeUsage(inputTokens: number): { type: 'message_usage'; inputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; outputTokens: number; costUsd: number; contextWindow: number } {
  return { type: 'message_usage', inputTokens, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 100, costUsd: 0.001, contextWindow: 200_000 };
}

describe('AgentMessageHandler — message_usage without prior tools', () => {
  it('calls updateUsage', () => {
    const statusState = new StatusState(new MemoryFileSystem({}, '/home/user', '/test'));
    const layout = makeLayout();
    makeHandler(layout, { statusState }).handle(makeUsage(1000));
    expect(statusState.totalInputTokens).toBe(1000);
  });

  it('does not annotate when no tool batch is open', () => {
    const layout = makeLayout();
    makeHandler(layout).handle(makeUsage(1000));
    const expected = 0;
    const actual = vi.mocked(layout.appendToLastSealed).mock.calls.length;
    expect(actual).toBe(expected);
  });
});

describe('AgentMessageHandler — message_usage delta annotation', () => {
  it('annotates the tools block with token delta after a tool batch', () => {
    const layout = makeLayout();
    const handler = makeHandler(layout);
    // Establish a baseline usage, then fire a tool that snapshots it
    handler.handle(makeUsage(1000));
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    // Next usage shows 500 more input tokens
    handler.handle(makeUsage(1500));
    const expected = true;
    const annotation = vi.mocked(layout.appendToLastSealed).mock.calls[0]?.[1] ?? '';
    const actual = annotation.includes('+500');
    expect(actual).toBe(expected);
  });

  it('resets usageBeforeTools after the annotation so second batch computes independently', () => {
    const layout = makeLayout();
    const handler = makeHandler(layout);
    handler.handle(makeUsage(1000));
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1500));
    // Second tool batch
    handler.handle({ type: 'tool_approval_request', requestId: 'r2', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1700));
    // appendToLastSealed should have been called twice, second annotation for +200
    const expected = 2;
    const actual = vi.mocked(layout.appendToLastSealed).mock.calls.length;
    expect(actual).toBe(expected);
  });

  it('second batch delta is computed from the post-first-batch usage, not the original', () => {
    const layout = makeLayout();
    const handler = makeHandler(layout);
    handler.handle(makeUsage(1000));
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1500));
    handler.handle({ type: 'tool_approval_request', requestId: 'r2', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1700));
    const expected = true;
    const secondAnnotation = vi.mocked(layout.appendToLastSealed).mock.calls[1]?.[1] ?? '';
    const actual = secondAnnotation.includes('+200');
    expect(actual).toBe(expected);
  });

  it('does not snapshot usageBeforeTools again if batch already open', () => {
    const layout = makeLayout();
    const handler = makeHandler(layout);
    handler.handle(makeUsage(1000));
    // Two tools in the same batch before usage arrives
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    handler.handle({ type: 'tool_approval_request', requestId: 'r2', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1800));
    // Delta should be relative to the 1000 baseline, not the second tool
    const expected = true;
    const annotation = vi.mocked(layout.appendToLastSealed).mock.calls[0]?.[1] ?? '';
    const actual = annotation.includes('+800');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_compaction with lastUsage
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — message_compaction annotation', () => {
  it('appends context-usage annotation when lastUsage is known', () => {
    const layout = makeLayout();
    const handler = makeHandler(layout);
    handler.handle(makeUsage(150_000));
    handler.handle({ type: 'message_compaction', summary: 'trimmed' });
    const calls = vi.mocked(layout.appendStreaming).mock.calls;
    const expected = true;
    const actual = calls.some((c) => (c[0] ?? '').includes('compacted at'));
    expect(actual).toBe(expected);
  });

  it('omits annotation when lastUsage is not yet known', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'message_compaction', summary: 'trimmed' });
    const calls = vi.mocked(layout.appendStreaming).mock.calls;
    const expected = false;
    const actual = calls.some((c) => (c[0] ?? '').includes('compacted at'));
    expect(actual).toBe(expected);
  });
});
