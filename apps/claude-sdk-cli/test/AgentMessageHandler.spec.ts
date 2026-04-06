import { describe, expect, it, vi } from 'vitest';
import { AgentMessageHandler } from '../src/AgentMessageHandler.js';
import type { AppLayout } from '../src/AppLayout.js';
import { logger } from '../src/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLayout() {
  return {
    transitionBlock: vi.fn(),
    appendStreaming: vi.fn(),
  } as unknown as AppLayout;
}

function makeHandler(layout: AppLayout) {
  return new AgentMessageHandler(layout, logger);
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

  it('streams the parts joined by ·', () => {
    const layout = makeLayout();
    makeHandler(layout).handle({ type: 'query_summary', systemPrompts: 1, userMessages: 2, assistantMessages: 1, thinkingBlocks: 0 });
    const expected = '1 system · 2 user · 1 assistant';
    const actual = vi.mocked(layout.appendStreaming).mock.calls[0]?.[0];
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
