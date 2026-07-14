import { DatabaseSync } from 'node:sqlite';
import type { HistoryBlock, HistoryMessage, HistoryRole } from '@shellicar/claude-core/history/types';
import { describe, expect, it } from 'vitest';
import { SqliteHistoryEngine } from '../src/persistence/SqliteHistoryEngine.js';

function engine() {
  return new SqliteHistoryEngine(new DatabaseSync(':memory:'));
}

function block(type: string, text: string | null, seq = 0): HistoryBlock {
  return { seq, type, text };
}

function msg(id: string, turnId: string, timestamp: string, role: HistoryRole, blocks: HistoryBlock[], conversationId = 'c1'): HistoryMessage {
  return { id, conversationId, turnId, queryId: 'q1', timestamp, role, blocks };
}

describe('SqliteHistoryEngine — dedup on message id', () => {
  it('drops a repeat insert of the same message id', () => {
    const e = engine();
    const m = msg('m1', 't1', '2026-01-01T00:00:00Z', 'assistant', [block('text', 'hello sqlite')]);
    e.insert(m);
    e.insert(m);

    const expected = 1;
    const actual = e.read({ citations: ['t1'], window: 0 })[0].events.length;
    expect(actual).toBe(expected);
  });
});

describe('SqliteHistoryEngine — thinking is indexed', () => {
  it('finds a match inside a thinking block', () => {
    const e = engine();
    e.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', 'assistant', [block('thinking', 'the plan is to refactor the parser')]));

    const expected = 1;
    const actual = e.search({ query: 'parser', limit: 10 }).length;
    expect(actual).toBe(expected);
  });
});

describe('SqliteHistoryEngine — per-type weighting', () => {
  it('ranks a prose match above a tool_use match on an equal term', () => {
    const e = engine();
    e.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', 'assistant', [block('text', 'sqlite')]));
    e.insert(msg('m2', 't2', '2026-01-01T00:01:00Z', 'assistant', [block('tool_use', 'sqlite')]));

    const expected = 'text';
    const actual = e.search({ query: 'sqlite', limit: 10 })[0].type;
    expect(actual).toBe(expected);
  });
});

describe('SqliteHistoryEngine — filters', () => {
  it('returns only hits from the requested role', () => {
    const e = engine();
    e.insert(msg('u1', 't1', '2026-01-01T00:00:00Z', 'user', [block('text', 'sqlite question')]));
    e.insert(msg('a1', 't1', '2026-01-01T00:00:00Z', 'assistant', [block('text', 'sqlite answer')]));

    const expected = ['user'];
    const actual = e.search({ query: 'sqlite', role: 'user', limit: 10 }).map((hit) => hit.role);
    expect(actual).toEqual(expected);
  });

  it('returns only hits of the requested type', () => {
    const e = engine();
    e.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', 'assistant', [block('text', 'sqlite prose', 0), block('thinking', 'sqlite reasoning', 1)]));

    const expected = ['thinking'];
    const actual = e.search({ query: 'sqlite', type: 'thinking', limit: 10 }).map((hit) => hit.type);
    expect(actual).toEqual(expected);
  });
});

describe('SqliteHistoryEngine — citation carries the conversation', () => {
  it('returns the conversationId on a search hit', () => {
    const e = engine();
    e.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', 'assistant', [block('text', 'sqlite')], 'conv-a'));

    const expected = 'conv-a';
    const actual = e.search({ query: 'sqlite', limit: 10 })[0].conversationId;
    expect(actual).toBe(expected);
  });

  it('centres a read window on the citation conversation', () => {
    const e = engine();
    e.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', 'assistant', [block('text', 'hello')], 'conv-b'));

    const expected = 'conv-b';
    const actual = e.read({ citations: ['t1'], window: 0 })[0].conversationId;
    expect(actual).toBe(expected);
  });
});

describe('SqliteHistoryEngine — read window', () => {
  it('opens the turns around the citation in chronological order', () => {
    const e = engine();
    e.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', 'assistant', [block('text', 'first')]));
    e.insert(msg('m2', 't2', '2026-01-01T00:01:00Z', 'assistant', [block('text', 'second')]));
    e.insert(msg('m3', 't3', '2026-01-01T00:02:00Z', 'assistant', [block('text', 'third')]));

    const expected = ['first', 'second', 'third'];
    const actual = e.read({ citations: ['t2'], window: 1 })[0].events.map((event) => event.text);
    expect(actual).toEqual(expected);
  });

  it('orders the user event before the assistant event within a turn', () => {
    const e = engine();
    e.insert(msg('a1', 't1', '2026-01-01T00:00:00Z', 'assistant', [block('text', 'answer')]));
    e.insert(msg('u1', 't1', '2026-01-01T00:00:00Z', 'user', [block('text', 'question')]));

    const expected = ['user', 'assistant'];
    const actual = e.read({ citations: ['t1'], window: 0 })[0].events.map((event) => event.role);
    expect(actual).toEqual(expected);
  });

  it('caps a long event text', () => {
    const e = engine();
    e.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', 'assistant', [block('text', 'x'.repeat(5000))]));

    const expected = 2001; // 2000 chars + the ellipsis marker
    const actual = e.read({ citations: ['t1'], window: 0 })[0].events[0].text.length;
    expect(actual).toBe(expected);
  });

  it('returns an empty window for an unknown citation', () => {
    const e = engine();

    const expected = 0;
    const actual = e.read({ citations: ['missing'], window: 3 })[0].events.length;
    expect(actual).toBe(expected);
  });
});
