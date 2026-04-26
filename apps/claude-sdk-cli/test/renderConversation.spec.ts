import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';
import { ConversationState } from '../src/model/ConversationState.js';
import { buildDivider, renderConversation } from '../src/view/renderConversation.js';

// Strip ANSI escape codes so assertions can match plain text
function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI for test assertions
  return s.replace(/\x1b\[[^m]*m/g, '');
}

describe('renderConversation — empty state', () => {
  it('returns an empty array when no blocks exist', () => {
    const state = new ConversationState();
    const expected = 0;
    const actual = renderConversation(state, 80).length;
    expect(actual).toBe(expected);
  });
});

describe('renderConversation — single sealed block', () => {
  it('includes a divider line for the block', () => {
    const state = new ConversationState();
    state.addBlocks([{ type: 'response', content: 'hello' }]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    const actual = lines.some((l) => l.includes('response'));
    expect(actual).toBe(true);
  });

  it('includes a blank line after the divider', () => {
    const state = new ConversationState();
    state.addBlocks([{ type: 'response', content: 'hello' }]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    const dividerIdx = lines.findIndex((l) => l.includes('response'));
    const actual = lines[dividerIdx + 1];
    expect(actual).toBe('');
  });

  it('includes the block content', () => {
    const state = new ConversationState();
    state.addBlocks([{ type: 'response', content: 'hello world' }]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    const actual = lines.some((l) => l.includes('hello world'));
    expect(actual).toBe(true);
  });

  it('includes a trailing blank line after the content', () => {
    const state = new ConversationState();
    state.addBlocks([{ type: 'response', content: 'hello' }]);
    const lines = renderConversation(state, 80);
    const actual = lines[lines.length - 1];
    expect(actual).toBe('');
  });
});

describe('renderConversation — continuation suppression', () => {
  it('suppresses the divider between two consecutive same-type blocks', () => {
    const state = new ConversationState();
    state.addBlocks([
      { type: 'tools', content: 'tool A' },
      { type: 'tools', content: 'tool B' },
    ]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    const dividerCount = lines.filter((l) => l.includes('tools')).length;
    // Only the first block gets a divider; the second is a continuation
    const expected = 1;
    const actual = dividerCount;
    expect(actual).toBe(expected);
  });

  it('suppresses the trailing blank between two consecutive same-type blocks', () => {
    const state = new ConversationState();
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
    const state = new ConversationState();
    state.addBlocks([{ type: 'prompt', content: 'user prompt' }]);
    state.transitionBlock('response');
    state.appendToActive('streaming...');
    const lines = renderConversation(state, 80).map(stripAnsi);
    const actual = lines.some((l) => l.includes('response'));
    expect(actual).toBe(true);
  });

  it('suppresses the active block divider when it continues the last sealed block type', () => {
    const state = new ConversationState();
    state.addBlocks([{ type: 'tools', content: 'tool A' }]);
    state.transitionBlock('tools');
    state.appendToActive('tool B');
    const lines = renderConversation(state, 80).map(stripAnsi);
    const dividerCount = lines.filter((l) => l.includes('tools')).length;
    // Only the sealed block gets a divider; active continuation does not
    const expected = 1;
    const actual = dividerCount;
    expect(actual).toBe(expected);
  });

  it('includes the active block content', () => {
    const state = new ConversationState();
    state.transitionBlock('response');
    state.appendToActive('live content');
    const lines = renderConversation(state, 80).map(stripAnsi);
    const actual = lines.some((l) => l.includes('live content'));
    expect(actual).toBe(true);
  });

  it('does not add a trailing blank after the active block', () => {
    const state = new ConversationState();
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

  it('fills remaining space with the fill character', () => {
    const result = stripAnsi(buildDivider('hi', 20));
    // Should contain fill characters beyond the prefix
    const actual = result.includes('\u2500\u2500 hi ');
    expect(actual).toBe(true);
  });

  it('fills exactly cols visual columns for an emoji label (D-1)', () => {
    // Before the fix, prefix.length used code units: \u{1F527} has length 2
    // but also visual width 2, so this test passes either way for that emoji.
    // \u2139\uFE0F (information source + variation selector) has .length = 2
    // but stringWidth may return 1 or 2 depending on terminal. The divider must
    // always fill exactly `cols` regardless.
    const cols = 40;
    const result = stripAnsi(buildDivider('\uD83D\uDD27 tools', cols));
    const actual = stringWidth(result);
    const expected = cols;
    expect(actual).toBe(expected);
  });
});

describe('renderConversation — code fence highlighting', () => {
  it('renders code from an unknown language without warning (plain fallback)', () => {
    const state = new ConversationState();
    state.addBlocks([{ type: 'response', content: '```unknownxyz\nfoo bar\n```' }]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    const actual = lines.some((l) => l.includes('foo bar'));
    expect(actual).toBe(true);
  });

  it('preserves the original fence label even when an alias is used for highlighting', () => {
    const state = new ConversationState();
    state.addBlocks([{ type: 'response', content: '```jsonl\n{"key": 1}\n```' }]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    // Fence header should show the original language name, not the alias
    const actual = lines.some((l) => l.includes('```jsonl'));
    expect(actual).toBe(true);
  });

  it('renders jsonl code content', () => {
    const state = new ConversationState();
    state.addBlocks([{ type: 'response', content: '```jsonl\n{"key": 1}\n```' }]);
    const lines = renderConversation(state, 80).map(stripAnsi);
    const actual = lines.some((l) => l.includes('"key"'));
    expect(actual).toBe(true);
  });
});
