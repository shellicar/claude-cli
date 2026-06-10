import { Clock, Instant, ZoneId } from '@js-joda/core';
import { describe, expect, it } from 'vitest';
import { ConversationState } from '../src/model/ConversationState.js';

class FakeClock extends Clock {
  #current: Instant;
  public constructor(start: Instant) {
    super();
    this.#current = start;
  }
  public override zone(): ZoneId {
    return ZoneId.UTC;
  }
  public override withZone(_zone: ZoneId): Clock {
    return this;
  }
  public override instant(): Instant {
    return this.#current;
  }
  public override millis(): number {
    return this.#current.toEpochMilli();
  }
  public override equals(obj: unknown): boolean {
    return this === obj;
  }
  public advanceTo(next: Instant): void {
    this.#current = next;
  }
}

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

describe('ConversationState — appendStreaming', () => {
  it('opens a notice block when there is no active block', () => {
    const state = new ConversationState();
    state.appendStreaming('hello');
    const expected = 'notice';
    const actual = state.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('auto-opened notice block contains the streamed content', () => {
    const state = new ConversationState();
    state.appendStreaming('hello');
    const expected = 'hello';
    const actual = state.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('appends to the existing active block without opening a text block', () => {
    const state = new ConversationState();
    state.transitionBlock('response');
    state.appendStreaming('hello');
    const expected = 'response';
    const actual = state.activeBlock?.type;
    expect(actual).toBe(expected);
  });
});

describe('ConversationState — spliceNotice', () => {
  it('opens a notice block when there is no active block', () => {
    const state = new ConversationState();
    state.spliceNotice('watch out');
    const expected = 'notice';
    const actual = state.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('notice block contains the text followed by a newline', () => {
    const state = new ConversationState();
    state.spliceNotice('watch out');
    const expected = 'watch out\n';
    const actual = state.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('splices after the last newline when the active block has one', () => {
    const state = new ConversationState();
    state.transitionBlock('response');
    state.appendToActive('Hello,\nI am,');
    state.spliceNotice('[notice]');
    const expected = 'Hello,\n[notice]\nI am,';
    const actual = state.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('streaming after the splice appends after the spliced content', () => {
    const state = new ConversationState();
    state.transitionBlock('response');
    state.appendToActive('Hello,\nI am,');
    state.spliceNotice('[notice]');
    state.appendStreaming(' Claude.');
    const expected = 'Hello,\n[notice]\nI am, Claude.';
    const actual = state.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('appends notice after current content when no newline exists yet', () => {
    const state = new ConversationState();
    state.transitionBlock('response');
    state.appendToActive('Hello');
    state.spliceNotice('[notice]');
    const expected = 'Hello\n[notice]\n';
    const actual = state.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('streaming after no-newline splice continues after notice', () => {
    const state = new ConversationState();
    state.transitionBlock('response');
    state.appendToActive('Hello');
    state.spliceNotice('[notice]');
    state.appendStreaming(', world.');
    const expected = 'Hello\n[notice]\n, world.';
    const actual = state.activeBlock?.content;
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

describe('ConversationState — replaceActiveFromOffset', () => {
  it('replaces content from the given offset to the end with the supplied text', () => {
    const state = new ConversationState();
    state.transitionBlock('tools');
    state.appendToActive('🌐 web_search{"query":"foo"}');
    state.replaceActiveFromOffset(0, '🌐 web_search(foo)');
    const expected = '🌐 web_search(foo)';
    const actual = state.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('preserves content before the offset', () => {
    const state = new ConversationState();
    state.transitionBlock('tools');
    state.appendToActive('🌐 web_search(foo) ✅\n');
    const mark = state.activeBlock?.content.length ?? 0;
    state.appendToActive('🌐 web_fetch{"url":"https://example.com"}');
    state.replaceActiveFromOffset(mark, '🌐 web_fetch(https://example.com)');
    const expected = '🌐 web_search(foo) ✅\n🌐 web_fetch(https://example.com)';
    const actual = state.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('is a no-op when there is no active block', () => {
    const state = new ConversationState();
    state.replaceActiveFromOffset(0, 'text');
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

describe('ConversationState — setActiveBlockContent', () => {
  it('replaces the active block content entirely', () => {
    const state = new ConversationState();
    state.transitionBlock('tools');
    state.appendToActive('old');
    state.setActiveBlockContent('new');
    const expected = 'new';
    const actual = state.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('is a no-op when there is no active block', () => {
    const state = new ConversationState();
    state.setActiveBlockContent('ignored');
    const expected = null;
    const actual = state.activeBlock;
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

describe('ConversationState — timestamps on transitionBlock', () => {
  it('stamps createdAt on the new active block', () => {
    const t = Instant.parse('2025-01-01T10:00:00Z');
    const state = new ConversationState(Clock.fixed(t, ZoneId.UTC));
    state.transitionBlock('response');
    const expected = t;
    const actual = state.activeBlock?.createdAt;
    expect(actual).toEqual(expected);
  });

  it('does not set exitedAt on the active block while live', () => {
    const state = new ConversationState();
    state.transitionBlock('response');
    const expected = undefined;
    const actual = state.activeBlock?.exitedAt;
    expect(actual).toBe(expected);
  });

  it('stamps exitedAt on the sealed block when transitioning away', () => {
    const t1 = Instant.parse('2025-01-01T10:00:00Z');
    const t2 = Instant.parse('2025-01-01T10:00:15Z');
    const clock = new FakeClock(t1);
    const state = new ConversationState(clock);
    state.transitionBlock('response');
    state.appendToActive('content');
    clock.advanceTo(t2);
    state.transitionBlock('thinking');
    const expected = t2;
    const actual = state.sealedBlocks[0]?.exitedAt;
    expect(actual).toEqual(expected);
  });

  it('exitedAt is strictly after createdAt when time advanced', () => {
    const t1 = Instant.parse('2025-01-01T10:00:00Z');
    const t2 = Instant.parse('2025-01-01T10:00:15Z');
    const clock = new FakeClock(t1);
    const state = new ConversationState(clock);
    state.transitionBlock('response');
    state.appendToActive('content');
    clock.advanceTo(t2);
    state.transitionBlock('thinking');
    const block = state.sealedBlocks[0];
    const expected = true;
    const actual = block?.createdAt !== undefined && block.exitedAt !== undefined && block.exitedAt.isAfter(block.createdAt);
    expect(actual).toBe(expected);
  });
});

describe('ConversationState — timestamps on completeActive', () => {
  it('stamps exitedAt when completeActive seals the block', () => {
    const t1 = Instant.parse('2025-01-01T10:00:00Z');
    const t2 = Instant.parse('2025-01-01T10:00:30Z');
    const clock = new FakeClock(t1);
    const state = new ConversationState(clock);
    state.transitionBlock('response');
    state.appendToActive('content');
    clock.advanceTo(t2);
    state.completeActive();
    const expected = t2;
    const actual = state.sealedBlocks[0]?.exitedAt;
    expect(actual).toEqual(expected);
  });

  it('createdAt is preserved on the sealed block after completeActive', () => {
    const t1 = Instant.parse('2025-01-01T10:00:00Z');
    const t2 = Instant.parse('2025-01-01T10:00:30Z');
    const clock = new FakeClock(t1);
    const state = new ConversationState(clock);
    state.transitionBlock('response');
    state.appendToActive('content');
    clock.advanceTo(t2);
    state.completeActive();
    const expected = t1;
    const actual = state.sealedBlocks[0]?.createdAt;
    expect(actual).toEqual(expected);
  });
});

describe('ConversationState — markPromptStart', () => {
  it('uses the marked instant as createdAt on the next prompt transitionBlock', () => {
    const t1 = Instant.parse('2025-01-01T10:00:00Z');
    const t2 = Instant.parse('2025-01-01T10:00:30Z');
    const clock = new FakeClock(t1);
    const state = new ConversationState(clock);
    state.markPromptStart(); // records t1
    clock.advanceTo(t2); // time moves before submit
    state.transitionBlock('prompt');
    const expected = t1;
    const actual = state.activeBlock?.createdAt;
    expect(actual).toEqual(expected);
  });

  it('clears the stored instant after transitionBlock consumes it', () => {
    const t1 = Instant.parse('2025-01-01T10:00:00Z');
    const t2 = Instant.parse('2025-01-01T10:00:30Z');
    const t3 = Instant.parse('2025-01-01T10:01:00Z');
    const clock = new FakeClock(t1);
    const state = new ConversationState(clock);
    state.markPromptStart();
    clock.advanceTo(t2);
    state.transitionBlock('prompt');
    state.appendToActive('first');
    state.completeActive();
    // second prompt — no markPromptStart, so createdAt should be t3
    clock.advanceTo(t3);
    state.transitionBlock('prompt');
    const expected = t3;
    const actual = state.activeBlock?.createdAt;
    expect(actual).toEqual(expected);
  });

  it('does not affect createdAt for non-prompt block types', () => {
    const t1 = Instant.parse('2025-01-01T10:00:00Z');
    const t2 = Instant.parse('2025-01-01T10:00:30Z');
    const clock = new FakeClock(t1);
    const state = new ConversationState(clock);
    state.markPromptStart(); // records t1
    clock.advanceTo(t2);
    state.transitionBlock('response');
    // response block createdAt should be t2, not t1
    const expected = t2;
    const actual = state.activeBlock?.createdAt;
    expect(actual).toEqual(expected);
  });
});
