import { describe, expect, it } from 'vitest';
import { historyKeyMap } from '../src/controller/historyKeyMap.js';
import type { Block } from '../src/model/ConversationState.js';
import { HistoryViewState } from '../src/model/HistoryViewState.js';

function nonTools(): Block[] {
  return [{ type: 'response', content: 'reply' }];
}

describe('historyKeyMap — on a list', () => {
  it('maps up to prev', () => {
    const expected = 'prev';
    const actual = historyKeyMap(new HistoryViewState(), { type: 'up' });
    expect(actual).toBe(expected);
  });

  it('maps down to next', () => {
    const expected = 'next';
    const actual = historyKeyMap(new HistoryViewState(), { type: 'down' });
    expect(actual).toBe(expected);
  });

  it('maps right to open', () => {
    const expected = 'open';
    const actual = historyKeyMap(new HistoryViewState(), { type: 'right' });
    expect(actual).toBe(expected);
  });

  it('maps left to close', () => {
    const expected = 'close';
    const actual = historyKeyMap(new HistoryViewState(), { type: 'left' });
    expect(actual).toBe(expected);
  });
});

describe('historyKeyMap — inside content', () => {
  function inContent(): HistoryViewState {
    const state = new HistoryViewState();
    state.apply('open', nonTools());
    return state;
  }

  it('maps up to scroll-up', () => {
    const expected = 'scroll-up';
    const actual = historyKeyMap(inContent(), { type: 'up' });
    expect(actual).toBe(expected);
  });

  it('maps down to scroll-down', () => {
    const expected = 'scroll-down';
    const actual = historyKeyMap(inContent(), { type: 'down' });
    expect(actual).toBe(expected);
  });

  it('maps right to null', () => {
    const expected = null;
    const actual = historyKeyMap(inContent(), { type: 'right' });
    expect(actual).toBe(expected);
  });

  it('maps left to close', () => {
    const expected = 'close';
    const actual = historyKeyMap(inContent(), { type: 'left' });
    expect(actual).toBe(expected);
  });
});

describe('historyKeyMap — unmapped keys', () => {
  it('returns null for a printable character', () => {
    const expected = null;
    const actual = historyKeyMap(new HistoryViewState(), { type: 'char', value: 'a' });
    expect(actual).toBe(expected);
  });
});

describe('historyKeyMap — paging and jumps', () => {
  it('maps PgUp to page-up', () => {
    const expected = 'page-up';
    const actual = historyKeyMap(new HistoryViewState(), { type: 'page_up' });
    expect(actual).toBe(expected);
  });

  it('maps PgDn to page-down', () => {
    const expected = 'page-down';
    const actual = historyKeyMap(new HistoryViewState(), { type: 'page_down' });
    expect(actual).toBe(expected);
  });

  it('maps Home to home', () => {
    const expected = 'home';
    const actual = historyKeyMap(new HistoryViewState(), { type: 'home' });
    expect(actual).toBe(expected);
  });

  it('maps End to end', () => {
    const expected = 'end';
    const actual = historyKeyMap(new HistoryViewState(), { type: 'end' });
    expect(actual).toBe(expected);
  });
});
