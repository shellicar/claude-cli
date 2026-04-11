import { describe, expect, it } from 'vitest';
import { ConversationState } from '../src/model/ConversationState.js';

describe('ConversationState — initial state', () => {
  it('sealedBlocks starts empty', () => {
    const state = new ConversationState();
    const expected = 0;
    const actual = state.sealedBlocks.length;
    expect(actual).toBe(expected);
  });

  it('flushedCount starts at zero', () => {
    const state = new ConversationState();
    const expected = 0;
    const actual = state.flushedCount;
    expect(actual).toBe(expected);
  });

  it('activeBlock starts null', () => {
    const state = new ConversationState();
    const expected = null;
    const actual = state.activeBlock;
    expect(actual).toBe(expected);
  });
});

describe('ConversationState — addBlocks', () => {
  it('pushes blocks into sealedBlocks', () => {
    const state = new ConversationState();
    state.addBlocks([
      { type: 'meta', content: 'hello' },
      { type: 'prompt', content: 'world' },
    ]);
    const expected = 2;
    const actual = state.sealedBlocks.length;
    expect(actual).toBe(expected);
  });

  it('preserves block content', () => {
    const state = new ConversationState();
    state.addBlocks([{ type: 'response', content: 'test content' }]);
    const expected = 'test content';
    const actual = state.sealedBlocks[0]?.content;
    expect(actual).toBe(expected);
  });
});

describe('ConversationState — transitionBlock', () => {
  it('creates an active block with the given type', () => {
    const state = new ConversationState();
    state.transitionBlock('response');
    const expected = 'response';
    const actual = state.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('active block starts with empty content', () => {
    const state = new ConversationState();
    state.transitionBlock('thinking');
    const expected = '';
    const actual = state.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('returns noop: true when same type already active', () => {
    const state = new ConversationState();
    state.transitionBlock('tools');
    const result = state.transitionBlock('tools');
    const expected = true;
    const actual = result.noop;
    expect(actual).toBe(expected);
  });

  it('returns noop: false when transitioning to a different type', () => {
    const state = new ConversationState();
    state.transitionBlock('thinking');
    const result = state.transitionBlock('response');
    const expected = false;
    const actual = result.noop;
    expect(actual).toBe(expected);
  });

  it('seals non-empty active block on transition', () => {
    const state = new ConversationState();
    state.transitionBlock('thinking');
    state.appendToActive('some content');
    state.transitionBlock('response');
    const expected = 1;
    const actual = state.sealedBlocks.length;
    expect(actual).toBe(expected);
  });

  it('returns sealed: true when active block had content', () => {
    const state = new ConversationState();
    state.transitionBlock('thinking');
    state.appendToActive('content');
    const result = state.transitionBlock('response');
    const expected = true;
    const actual = result.sealed;
    expect(actual).toBe(expected);
  });

  it('discards empty active block without sealing', () => {
    const state = new ConversationState();
    state.transitionBlock('thinking');
    // no appendToActive call — content is empty
    state.transitionBlock('response');
    const expected = 0;
    const actual = state.sealedBlocks.length;
    expect(actual).toBe(expected);
  });

  it('returns sealed: false when active block was empty', () => {
    const state = new ConversationState();
    state.transitionBlock('thinking');
    const result = state.transitionBlock('response');
    const expected = false;
    const actual = result.sealed;
    expect(actual).toBe(expected);
  });

  it('returns from: null when no previous active block', () => {
    const state = new ConversationState();
    const result = state.transitionBlock('response');
    const expected = null;
    const actual = result.from;
    expect(actual).toBe(expected);
  });

  it('returns from: the previous type when transitioning', () => {
    const state = new ConversationState();
    state.transitionBlock('thinking');
    state.appendToActive('content');
    const result = state.transitionBlock('response');
    const expected = 'thinking';
    const actual = result.from;
    expect(actual).toBe(expected);
  });
});

describe('ConversationState — appendToActive', () => {
  it('appends text to the active block content', () => {
    const state = new ConversationState();
    state.transitionBlock('response');
    state.appendToActive('hello');
    state.appendToActive(' world');
    const expected = 'hello world';
    const actual = state.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('is a no-op when there is no active block', () => {
    const state = new ConversationState();
    // No transitionBlock call — activeBlock is null
    state.appendToActive('ignored');
    const expected = null;
    const actual = state.activeBlock;
    expect(actual).toBe(expected);
  });
});

describe('ConversationState — completeActive', () => {
  it('seals the active block when it has content', () => {
    const state = new ConversationState();
    state.transitionBlock('response');
    state.appendToActive('content');
    state.completeActive();
    const expected = 1;
    const actual = state.sealedBlocks.length;
    expect(actual).toBe(expected);
  });

  it('discards the active block when it is empty', () => {
    const state = new ConversationState();
    state.transitionBlock('response');
    // no content appended
    state.completeActive();
    const expected = 0;
    const actual = state.sealedBlocks.length;
    expect(actual).toBe(expected);
  });

  it('clears activeBlock after completing', () => {
    const state = new ConversationState();
    state.transitionBlock('response');
    state.appendToActive('content');
    state.completeActive();
    const expected = null;
    const actual = state.activeBlock;
    expect(actual).toBe(expected);
  });
});

describe('ConversationState — appendToLastSealed', () => {
  it('returns "active" and appends when type matches active block', () => {
    const state = new ConversationState();
    state.transitionBlock('tools');
    state.appendToActive('initial');
    const result = state.appendToLastSealed('tools', ' appended');
    const expected = 'active';
    const actual = result;
    expect(actual).toBe(expected);
  });

  it('content is updated on the active block', () => {
    const state = new ConversationState();
    state.transitionBlock('tools');
    state.appendToActive('initial');
    state.appendToLastSealed('tools', ' appended');
    const expected = 'initial appended';
    const actual = state.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('returns the sealed block index when found in sealed blocks', () => {
    const state = new ConversationState();
    state.transitionBlock('tools');
    state.appendToActive('tool content');
    state.transitionBlock('response'); // seals tools block at index 0
    const result = state.appendToLastSealed('tools', ' annotation');
    const expected = 0;
    const actual = result;
    expect(actual).toBe(expected);
  });

  it('content is updated on the sealed block', () => {
    const state = new ConversationState();
    state.transitionBlock('tools');
    state.appendToActive('tool content');
    state.transitionBlock('response');
    state.appendToLastSealed('tools', ' annotation');
    const expected = 'tool content annotation';
    const actual = state.sealedBlocks[0]?.content;
    expect(actual).toBe(expected);
  });

  it('returns "miss" when no matching block exists', () => {
    const state = new ConversationState();
    const result = state.appendToLastSealed('tools', 'annotation');
    const expected = 'miss';
    const actual = result;
    expect(actual).toBe(expected);
  });

  it('finds the most recent sealed block when multiple exist', () => {
    const state = new ConversationState();
    state.addBlocks([
      { type: 'tools', content: 'first' },
      { type: 'response', content: 'middle' },
      { type: 'tools', content: 'second' },
    ]);
    state.appendToLastSealed('tools', ' extra');
    // Most recent tools block is index 2
    const expected = 'second extra';
    const actual = state.sealedBlocks[2]?.content;
    expect(actual).toBe(expected);
  });
});

describe('ConversationState — advanceFlushedCount', () => {
  it('updates flushedCount to the given value', () => {
    const state = new ConversationState();
    state.addBlocks([
      { type: 'prompt', content: 'a' },
      { type: 'response', content: 'b' },
    ]);
    state.advanceFlushedCount(2);
    const expected = 2;
    const actual = state.flushedCount;
    expect(actual).toBe(expected);
  });
});
