import { describe, expect, it } from 'vitest';
import type { AuditSummary } from '../src/conversations/scanAuditSummary.js';
import { ConversationListState } from '../src/model/ConversationListState.js';

const summaryOf = (overrides: Partial<AuditSummary> = {}): AuditSummary => ({
  turns: 1,
  queries: 1,
  costUsd: 1,
  firstUtc: '2026-07-28T10:00:00.000Z',
  lastUtc: '2026-07-28T10:01:00.000Z',
  model: 'claude-sonnet-5',
  contextTokens: 100,
  firstUserText: 'the opening ask',
  lastAssistantText: 'the reply',
  ...overrides,
});

const listOf = (...ids: string[]): ConversationListState => {
  const state = new ConversationListState();
  state.setEntries(ids);
  return state;
};

describe('ConversationListState — entries', () => {
  it('lists one entry per conversation id', () => {
    const state = listOf('conv-a', 'conv-b');
    const expected = 2;
    const actual = state.entries.length;
    expect(actual).toBe(expected);
  });

  it('starts an entry with no summary, so the view can paint before the audit is read', () => {
    const state = listOf('conv-a');
    const actual = state.entries[0]?.summary;
    expect(actual).toBeUndefined();
  });

  it('selects the newest conversation on first load', () => {
    const state = listOf('conv-a', 'conv-b');
    const expected = 0;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });

  it('keeps the selection on the same conversation when the list is rebuilt', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('next');
    state.setEntries(['conv-new', 'conv-a', 'conv-b']);
    const expected = 'conv-b';
    const actual = state.selectedEntry?.id;
    expect(actual).toBe(expected);
  });

  it('falls back to the newest when the selected conversation is gone', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('next');
    state.setEntries(['conv-a']);
    const expected = 'conv-a';
    const actual = state.selectedEntry?.id;
    expect(actual).toBe(expected);
  });

  it('keeps a summary already loaded when the list is rebuilt', () => {
    const state = listOf('conv-a');
    state.setSummary('conv-a', summaryOf({ costUsd: 4.2 }));
    state.setEntries(['conv-a', 'conv-b']);
    const expected = 4.2;
    const actual = state.entries[0]?.summary?.costUsd;
    expect(actual).toBe(expected);
  });
});

describe('ConversationListState — setSummary', () => {
  it('lands the summary against its conversation', () => {
    const state = listOf('conv-a', 'conv-b');
    state.setSummary('conv-b', summaryOf({ costUsd: 9.5 }));
    const expected = 9.5;
    const actual = state.entries[1]?.summary?.costUsd;
    expect(actual).toBe(expected);
  });

  it('leaves other entries unfilled', () => {
    const state = listOf('conv-a', 'conv-b');
    state.setSummary('conv-b', summaryOf());
    const actual = state.entries[0]?.summary;
    expect(actual).toBeUndefined();
  });

  it('ignores a summary for a conversation no longer listed', () => {
    const state = listOf('conv-a');
    state.setEntries(['conv-b']);
    state.setSummary('conv-a', summaryOf());
    const actual = state.entries[0]?.summary;
    expect(actual).toBeUndefined();
  });
});

describe('ConversationListState — selection', () => {
  it('moves down the list', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('next');
    const expected = 1;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });

  it('stays put at the bottom', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('next');
    state.apply('next');
    const expected = 1;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });

  it('stays put at the top', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('prev');
    const expected = 0;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });

  it('moves a page at a time', () => {
    const state = listOf('a', 'b', 'c', 'd', 'e', 'f', 'g');
    state.apply('page-down');
    const expected = 5;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });

  it('clamps a page move to the last conversation', () => {
    const state = listOf('a', 'b', 'c');
    state.apply('page-down');
    const expected = 2;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });

  it('jumps to the last conversation on end', () => {
    const state = listOf('a', 'b', 'c');
    state.apply('end');
    const expected = 2;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });

  it('jumps to the first conversation on home', () => {
    const state = listOf('a', 'b', 'c');
    state.apply('end');
    state.apply('home');
    const expected = 0;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });

  it('does not move on an empty list', () => {
    const state = listOf();
    state.apply('next');
    const expected = 0;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });
});

describe('ConversationListState — peek', () => {
  it('opens the peek on the selected conversation', () => {
    const state = listOf('conv-a');
    state.apply('toggle-peek');
    const expected = true;
    const actual = state.peeked;
    expect(actual).toBe(expected);
  });

  it('closes the peek when toggled again', () => {
    const state = listOf('conv-a');
    state.apply('toggle-peek');
    state.apply('toggle-peek');
    const expected = false;
    const actual = state.peeked;
    expect(actual).toBe(expected);
  });

  it('stays open when the selection moves', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('toggle-peek');
    state.apply('next');
    const expected = true;
    const actual = state.peeked;
    expect(actual).toBe(expected);
  });

  it('drops the content of the conversation moved away from', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('toggle-peek');
    state.setPeek('conv-a', { entries: [{ kind: 'user', text: 'from conv-a', toolCount: 0, timestampUtc: null }], earlier: 0 });
    state.apply('next');
    const actual = state.peek;
    expect(actual).toBeUndefined();
  });

  it('ignores content that lands for the conversation just moved away from', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('toggle-peek');
    state.apply('next');
    state.setPeek('conv-a', { entries: [{ kind: 'user', text: 'from conv-a', toolCount: 0, timestampUtc: null }], earlier: 0 });
    const actual = state.peek;
    expect(actual).toBeUndefined();
  });

  it('does not peek an empty list', () => {
    const state = listOf();
    state.apply('toggle-peek');
    const expected = false;
    const actual = state.peeked;
    expect(actual).toBe(expected);
  });

  it('folds the peek on reset', () => {
    const state = listOf('conv-a');
    state.apply('toggle-peek');
    state.reset();
    const expected = false;
    const actual = state.peeked;
    expect(actual).toBe(expected);
  });
});
