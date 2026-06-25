import { describe, expect, it } from 'vitest';
import type { Block } from '../src/model/ConversationState.js';
import { HistoryViewState } from '../src/model/HistoryViewState.js';

function blocks(): Block[] {
  return [
    { type: 'prompt', content: 'ask' },
    {
      type: 'tools',
      content: 'tool lines',
      tools: [
        { name: 'ReadFile', kind: 'client', input: { path: 'a.ts' }, output: 'contents', phase: 'done' },
        { name: 'Exec', kind: 'client', input: { cmd: 'ls' }, output: 'list', phase: 'done' },
      ],
    },
    { type: 'response', content: 'reply' },
  ];
}

describe('HistoryViewState — initial state', () => {
  it('focuses the first block', () => {
    const expected = { block: 0, tool: null };
    const actual = new HistoryViewState().focus;
    expect(actual).toEqual(expected);
  });

  it('starts on a list, not in content', () => {
    const expected = 'list';
    const actual = new HistoryViewState().mode;
    expect(actual).toBe(expected);
  });
});

describe('HistoryViewState — move', () => {
  it('next moves focus to the following block', () => {
    const state = new HistoryViewState();
    state.apply('next', blocks());
    const expected = 1;
    const actual = state.focus.block;
    expect(actual).toBe(expected);
  });

  it('prev clamps at the first block', () => {
    const state = new HistoryViewState();
    state.apply('prev', blocks());
    const expected = 0;
    const actual = state.focus.block;
    expect(actual).toBe(expected);
  });

  it('next clamps at the last block', () => {
    const state = new HistoryViewState();
    const bs = blocks();
    state.apply('next', bs);
    state.apply('next', bs);
    state.apply('next', bs);
    const expected = 2;
    const actual = state.focus.block;
    expect(actual).toBe(expected);
  });

  it('does not emit a change when movement is clamped', () => {
    const state = new HistoryViewState();
    let count = 0;
    state.on('change', () => count++);
    state.apply('prev', blocks());
    const expected = 0;
    const actual = count;
    expect(actual).toBe(expected);
  });
});

describe('HistoryViewState — open', () => {
  it('opening a tools block descends to its first tool', () => {
    const state = new HistoryViewState();
    const bs = blocks();
    state.apply('next', bs);
    state.apply('open', bs);
    const expected = 0;
    const actual = state.focus.tool;
    expect(actual).toBe(expected);
  });

  it('opening a non-tools block opens its content', () => {
    const state = new HistoryViewState();
    state.apply('open', blocks());
    const expected = true;
    const actual = state.contentOpen;
    expect(actual).toBe(expected);
  });

  it('opening a focused tool opens its content', () => {
    const state = new HistoryViewState();
    const bs = blocks();
    state.apply('next', bs);
    state.apply('open', bs);
    state.apply('open', bs);
    const expected = true;
    const actual = state.contentOpen;
    expect(actual).toBe(expected);
  });

  it('mode reflects open content', () => {
    const state = new HistoryViewState();
    state.apply('open', blocks());
    const expected = 'content';
    const actual = state.mode;
    expect(actual).toBe(expected);
  });
});

describe('HistoryViewState — close', () => {
  it('closing folds open content first', () => {
    const state = new HistoryViewState();
    const bs = blocks();
    state.apply('next', bs);
    state.apply('open', bs); // descend to tool 0
    state.apply('open', bs); // open tool content
    state.apply('close', bs);
    const expected = false;
    const actual = state.contentOpen;
    expect(actual).toBe(expected);
  });

  it('closing an unfolded tools block folds back to the block list', () => {
    const state = new HistoryViewState();
    const bs = blocks();
    state.apply('next', bs);
    state.apply('open', bs); // descend to tool 0
    state.apply('close', bs);
    const expected = null;
    const actual = state.focus.tool;
    expect(actual).toBe(expected);
  });
});

describe('HistoryViewState — scroll', () => {
  it('scroll-down advances the offset when content is open', () => {
    const state = new HistoryViewState();
    state.apply('open', blocks());
    state.apply('scroll-down', blocks());
    const expected = 1;
    const actual = state.scrollOffset;
    expect(actual).toBe(expected);
  });

  it('scroll-down is a no-op when content is not open', () => {
    const state = new HistoryViewState();
    state.apply('scroll-down', blocks());
    const expected = 0;
    const actual = state.scrollOffset;
    expect(actual).toBe(expected);
  });

  it('scroll-up clamps the offset at zero', () => {
    const state = new HistoryViewState();
    state.apply('open', blocks());
    state.apply('scroll-up', blocks());
    const expected = 0;
    const actual = state.scrollOffset;
    expect(actual).toBe(expected);
  });
});

describe('HistoryViewState — move resets open state', () => {
  it('moving off an open item folds its content', () => {
    const state = new HistoryViewState();
    const bs = blocks();
    state.apply('open', bs); // open prompt content
    state.apply('next', bs);
    const expected = false;
    const actual = state.contentOpen;
    expect(actual).toBe(expected);
  });
});

describe('HistoryViewState — enterAtLatest', () => {
  it('focuses the last block', () => {
    const state = new HistoryViewState();
    state.enterAtLatest(3);
    const expected = 2;
    const actual = state.focus.block;
    expect(actual).toBe(expected);
  });

  it('focuses block 0 when there are no blocks', () => {
    const state = new HistoryViewState();
    state.enterAtLatest(0);
    const expected = 0;
    const actual = state.focus.block;
    expect(actual).toBe(expected);
  });
});

describe('HistoryViewState — home and end on a list', () => {
  it('end jumps to the last block', () => {
    const state = new HistoryViewState();
    state.apply('end', blocks());
    const expected = 2;
    const actual = state.focus.block;
    expect(actual).toBe(expected);
  });

  it('home jumps to the first block', () => {
    const state = new HistoryViewState();
    const bs = blocks();
    state.apply('end', bs);
    state.apply('home', bs);
    const expected = 0;
    const actual = state.focus.block;
    expect(actual).toBe(expected);
  });

  it('end is a no-op when already on the last block', () => {
    const state = new HistoryViewState();
    const bs = blocks();
    state.apply('end', bs);
    let count = 0;
    state.on('change', () => count++);
    state.apply('end', bs);
    const expected = 0;
    const actual = count;
    expect(actual).toBe(expected);
  });
});

describe('HistoryViewState — page on a list', () => {
  it('page-down advances by a page, clamped to the last block', () => {
    const state = new HistoryViewState();
    state.apply('page-down', blocks());
    const expected = 2;
    const actual = state.focus.block;
    expect(actual).toBe(expected);
  });
});

describe('HistoryViewState — scroll clamps to maxScroll', () => {
  it('end scrolls to the supplied maximum', () => {
    const state = new HistoryViewState();
    const bs = blocks();
    state.apply('open', bs); // open block 0 content
    state.apply('end', bs, 3);
    const expected = 3;
    const actual = state.scrollOffset;
    expect(actual).toBe(expected);
  });

  it('scroll-down is a no-op at the maximum', () => {
    const state = new HistoryViewState();
    const bs = blocks();
    state.apply('open', bs);
    state.apply('end', bs, 3);
    let count = 0;
    state.on('change', () => count++);
    state.apply('scroll-down', bs, 3);
    const expected = 0;
    const actual = count;
    expect(actual).toBe(expected);
  });

  it('home scrolls back to the top', () => {
    const state = new HistoryViewState();
    const bs = blocks();
    state.apply('open', bs);
    state.apply('end', bs, 3);
    state.apply('home', bs, 3);
    const expected = 0;
    const actual = state.scrollOffset;
    expect(actual).toBe(expected);
  });
});
