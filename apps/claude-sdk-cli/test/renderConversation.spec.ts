import { Clock, Instant, ZoneId } from '@js-joda/core';
import { createServiceCollection } from '@shellicar/core-di-lite';
import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';
import { ConversationState } from '../src/model/ConversationState.js';
import { buildDivider, type DividerTimestamps, renderBlockContentCached, renderConversation } from '../src/view/renderConversation.js';

// ConversationState injects Clock; build it through a container.
function buildConversationState(): ConversationState {
  const services = createServiceCollection();
  services.register(Clock).to(Clock, () => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC));
  services.register(ConversationState).to(ConversationState);
  return services.buildProvider().resolve(ConversationState);
}

// Strip ANSI escape codes so assertions can match plain text
function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI for test assertions
  return s.replace(/\x1b\[[^m]*m/g, '');
}

describe('renderConversation — empty state', () => {
  it('returns an empty array when no blocks exist', () => {
    const state = buildConversationState();
    const expected = 0;
    const actual = renderConversation(state, 80).length;
    expect(actual).toBe(expected);
  });
});

describe('renderConversation — single sealed block', () => {
  it('includes a divider line for the block', () => {
    const state = buildConversationState();
    state.addBlocks([{ type: 'response', content: 'hello' }]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    const actual = lines.some((l) => l.includes('response'));
    expect(actual).toBe(true);
  });

  it('includes a blank line after the divider', () => {
    const state = buildConversationState();
    state.addBlocks([{ type: 'response', content: 'hello' }]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    const dividerIdx = lines.findIndex((l) => l.includes('response'));
    const actual = lines[dividerIdx + 1];
    expect(actual).toBe('');
  });

  it('includes the block content', () => {
    const state = buildConversationState();
    state.addBlocks([{ type: 'response', content: 'hello world' }]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    const actual = lines.some((l) => l.includes('hello world'));
    expect(actual).toBe(true);
  });

  it('includes a trailing blank line after the content', () => {
    const state = buildConversationState();
    state.addBlocks([{ type: 'response', content: 'hello' }]);
    const lines = renderConversation(state, 80);
    const actual = lines[lines.length - 1];
    expect(actual).toBe('');
  });
});

describe('renderConversation — continuation suppression', () => {
  it('suppresses the divider between two consecutive same-type blocks', () => {
    const state = buildConversationState();
    state.addBlocks([
      { type: 'tools', content: 'tool A' },
      { type: 'tools', content: 'tool B' },
    ]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    const dividerCount = lines.filter((l) => l.includes('tool use')).length;
    // Only the first block gets a divider; the second is a continuation
    const expected = 1;
    const actual = dividerCount;
    expect(actual).toBe(expected);
  });

  it('suppresses the trailing blank between two consecutive same-type blocks', () => {
    const state = buildConversationState();
    state.addBlocks([
      { type: 'tools', content: 'tool A' },
      { type: 'tools', content: 'tool B' },
    ]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    // Find the line with "tool A"; the line after should NOT be blank (continuation)
    const aIdx = lines.findIndex((l) => l.includes('tool A'));
    const actual = lines[aIdx + 1];
    // Should be content of second block, not a blank gap
    expect(actual).not.toBe('');
  });
});

describe('renderConversation — active block', () => {
  it('includes a divider for the active block when it differs from the last sealed block', () => {
    const state = buildConversationState();
    state.addBlocks([{ type: 'prompt', content: 'user prompt' }]);
    state.transitionBlock('response');
    state.appendToActive('streaming...');
    const lines = renderConversation(state, 80).map(stripAnsi);
    const actual = lines.some((l) => l.includes('response'));
    expect(actual).toBe(true);
  });

  it('suppresses the active block divider when it continues the last sealed block type', () => {
    const state = buildConversationState();
    state.addBlocks([{ type: 'tools', content: 'tool A' }]);
    state.transitionBlock('tools');
    state.appendToActive('tool B');
    const lines = renderConversation(state, 80).map(stripAnsi);
    const dividerCount = lines.filter((l) => l.includes('tool use')).length;
    // Only the sealed block gets a divider; active continuation does not
    const expected = 1;
    const actual = dividerCount;
    expect(actual).toBe(expected);
  });

  it('includes the active block content', () => {
    const state = buildConversationState();
    state.transitionBlock('response');
    state.appendToActive('live content');
    const lines = renderConversation(state, 80).map(stripAnsi);
    const actual = lines.some((l) => l.includes('live content'));
    expect(actual).toBe(true);
  });

  it('does not add a trailing blank after the active block', () => {
    const state = buildConversationState();
    state.transitionBlock('response');
    state.appendToActive('streaming');
    const lines = renderConversation(state, 80);
    // Last line is the content, not a blank
    const actual = lines[lines.length - 1];
    expect(actual).not.toBe('');
  });
});

describe('buildDivider', () => {
  it('returns a plain DIM fill when label is null', () => {
    const result = stripAnsi(buildDivider(null, 10));
    const expected = '\u2500'.repeat(10);
    const actual = result;
    expect(actual).toBe(expected);
  });

  it('includes the label in the divider', () => {
    const result = stripAnsi(buildDivider('response', 40));
    const actual = result.includes('response');
    expect(actual).toBe(true);
  });

  it('pads a short labelled divider to the minimum width, below the terminal width', () => {
    const cols = 120;
    const result = stripAnsi(buildDivider('hi', cols));
    const expected = 60;
    const actual = stringWidth(result);
    expect(actual).toBe(expected);
  });

  it('caps the labelled divider at the terminal width when it is below the minimum', () => {
    const cols = 20;
    const result = stripAnsi(buildDivider('hi', cols));
    const expected = cols;
    const actual = stringWidth(result);
    expect(actual).toBe(expected);
  });
});

describe('renderConversation — notice block', () => {
  it('sealed notice block renders without a divider', () => {
    const state = buildConversationState();
    state.addBlocks([{ type: 'notice', content: 'some warning' }]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    const expected = false;
    const actual = lines.some((l) => l.includes('notice'));
    expect(actual).toBe(expected);
  });

  it('sealed notice block includes the content', () => {
    const state = buildConversationState();
    state.addBlocks([{ type: 'notice', content: 'some warning' }]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    const expected = true;
    const actual = lines.some((l) => l.includes('some warning'));
    expect(actual).toBe(expected);
  });

  it('active notice block renders without a divider', () => {
    const state = buildConversationState();
    state.transitionBlock('notice');
    state.appendToActive('[stop: max_tokens]');
    const lines = renderConversation(state, 80).map(stripAnsi);
    const expected = false;
    const actual = lines.some((l) => l.includes('notice'));
    expect(actual).toBe(expected);
  });

  it('active notice block includes the content', () => {
    const state = buildConversationState();
    state.transitionBlock('notice');
    state.appendToActive('[stop: max_tokens]');
    const lines = renderConversation(state, 80).map(stripAnsi);
    const expected = true;
    const actual = lines.some((l) => l.includes('[stop: max_tokens]'));
    expect(actual).toBe(expected);
  });

  it('notice block content is not indented', () => {
    const state = buildConversationState();
    state.addBlocks([{ type: 'notice', content: 'some warning' }]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    const noticeLine = lines.find((l) => l.includes('some warning'));
    const expected = 'some warning';
    const actual = noticeLine;
    expect(actual).toBe(expected);
  });
});

describe('renderConversation — code fence highlighting', () => {
  it('renders code from an unknown language without warning (plain fallback)', () => {
    const state = buildConversationState();
    state.addBlocks([{ type: 'response', content: '```unknownxyz\nfoo bar\n```' }]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    const actual = lines.some((l) => l.includes('foo bar'));
    expect(actual).toBe(true);
  });

  it('preserves the original fence label even when an alias is used for highlighting', () => {
    const state = buildConversationState();
    state.addBlocks([{ type: 'response', content: '```jsonl\n{"key": 1}\n```' }]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    // Fence header should show the original language name, not the alias
    const actual = lines.some((l) => l.includes('```jsonl'));
    expect(actual).toBe(true);
  });

  it('renders jsonl code content', () => {
    const state = buildConversationState();
    state.addBlocks([{ type: 'response', content: '```jsonl\n{"key": 1}\n```' }]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    const actual = lines.some((l) => l.includes('"key"'));
    expect(actual).toBe(true);
  });
});

describe('renderBlockContentCached — HistoryView shares this cache', () => {
  it('returns the identical array on a second call with the same block, content, cols, and markdown flag', () => {
    const state = buildConversationState();
    state.addBlocks([{ type: 'response', content: '```ts\nconst x = 1;\n```' }]);
    const block = state.sealedBlocks[0];
    if (!block) {
      throw new Error('expected a sealed block');
    }
    const first = renderBlockContentCached(block, block.content, 80, false);
    const second = renderBlockContentCached(block, block.content, 80, false);
    const actual = second === first;
    expect(actual).toBe(true);
  });

  it('recomputes when cols differs, e.g. HistoryView narrowing for the focus gutter', () => {
    const state = buildConversationState();
    state.addBlocks([{ type: 'response', content: 'hello' }]);
    const block = state.sealedBlocks[0];
    if (!block) {
      throw new Error('expected a sealed block');
    }
    renderBlockContentCached(block, block.content, 80, false);
    const second = renderBlockContentCached(block, block.content, 78, false);
    const actual = second.some((l) => l.includes('hello'));
    expect(actual).toBe(true);
  });

  it("caches a tools block's tool-name preview separately from its own content, without collision", () => {
    const state = buildConversationState();
    state.addBlocks([{ type: 'tools', content: 'raw tool content, never shown by HistoryView', tools: [] }]);
    const block = state.sealedBlocks[0];
    if (!block) {
      throw new Error('expected a sealed block');
    }
    const namesPreview = 'ReadFile . Exec';
    const first = renderBlockContentCached(block, namesPreview, 80, false);
    const second = renderBlockContentCached(block, namesPreview, 80, false);
    const actual = second === first && second.some((l) => l.includes('ReadFile'));
    expect(actual).toBe(true);
  });
});

describe('buildDivider — with timestamps', () => {
  it('includes createdAt when live (no exitedAt)', () => {
    const ts: DividerTimestamps = { createdAt: '15:29:03' };
    const result = stripAnsi(buildDivider('response', 80, ts));
    const actual = result.includes('15:29:03');
    expect(actual).toBe(true);
  });

  it('does not include an arrow when live', () => {
    const ts: DividerTimestamps = { createdAt: '15:29:03' };
    const result = stripAnsi(buildDivider('response', 80, ts));
    const actual = result.includes('→');
    expect(actual).toBe(false);
  });

  it('includes createdAt, arrow, exitedAt, and duration when exited', () => {
    const ts: DividerTimestamps = { createdAt: '15:29:03', exitedAt: '15:29:18', duration: '15s' };
    const result = stripAnsi(buildDivider('response', 80, ts));
    const actual = result.includes('15:29:03 → 15:29:18 (15s)');
    expect(actual).toBe(true);
  });

  it('pads to the minimum width, below the terminal width, when timestamps are present', () => {
    const ts: DividerTimestamps = { createdAt: '15:29:03' };
    const cols = 120;
    const result = stripAnsi(buildDivider('response', cols, ts));
    const expected = 60;
    const actual = stringWidth(result);
    expect(actual).toBe(expected);
  });

  it('renders without timestamps when no timestamps argument is passed', () => {
    const result = stripAnsi(buildDivider('response', 40));
    const actual = result.includes(':');
    expect(actual).toBe(false);
  });
});
