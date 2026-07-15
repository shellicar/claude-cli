import type { HistorySearchHit, HistoryWindow } from '@shellicar/claude-core/history/types';
import { describe, expect, it } from 'vitest';
import { createHistoryTools } from '../src/History/History';
import { call } from './helpers';
import { RecordingHistoryReader } from './RecordingHistoryReader';

const FIXED_NOW = new Date('2026-01-15T00:00:00.000Z');

function tools(sessionId = 'live-session', reader = new RecordingHistoryReader()) {
  const [SearchHistory, ReadHistory] = createHistoryTools(reader, () => sessionId, () => FIXED_NOW);
  return { reader, SearchHistory, ReadHistory };
}

const hit = (over: Partial<HistorySearchHit> = {}): HistorySearchHit => ({ conversationId: 'conv-a', turn: 3, timestamp: '2026-01-10T00:00:00Z', role: 'assistant', type: 'text', snippet: 's', score: 1, ...over }) satisfies HistorySearchHit;

const window = (over: Partial<HistoryWindow> = {}): HistoryWindow => ({ conversationId: 'conv-a', turn: 3, events: [], ...over }) satisfies HistoryWindow;

describe('SearchHistory — mapping', () => {
  it('forwards query, role, type and limit to the reader', async () => {
    const { reader, SearchHistory } = tools();
    await call(SearchHistory, { query: 'sqlite', role: 'assistant', type: 'thinking', limit: 5 });

    const expected = { query: 'sqlite', role: 'assistant', type: 'thinking', limit: 5 };
    const actual = { query: reader.searchArg?.query, role: reader.searchArg?.role, type: reader.searchArg?.type, limit: reader.searchArg?.limit };
    expect(actual).toEqual(expected);
  });

  it('resolves a relative since span to an ISO cutoff back from now', async () => {
    const { reader, SearchHistory } = tools();
    await call(SearchHistory, { query: 'sqlite', since: '7d' });

    const expected = '2026-01-08T00:00:00.000Z';
    const actual = reader.searchArg?.since;
    expect(actual).toBe(expected);
  });

  it('leaves since unset when no span is given', async () => {
    const { reader, SearchHistory } = tools();
    await call(SearchHistory, { query: 'sqlite' });

    const actual = reader.searchArg?.since;
    expect(actual).toBeUndefined();
  });

  it('excludes the live session by default', async () => {
    const { reader, SearchHistory } = tools('live-session');
    await call(SearchHistory, { query: 'sqlite' });

    const expected = 'live-session';
    const actual = reader.searchArg?.excludeConversationId;
    expect(actual).toBe(expected);
  });

  it('includes the live session when asked', async () => {
    const { reader, SearchHistory } = tools('live-session');
    await call(SearchHistory, { query: 'sqlite', includeCurrentSession: true });

    const actual = reader.searchArg?.excludeConversationId;
    expect(actual).toBeUndefined();
  });
});

describe('SearchHistory — shaping', () => {
  it('maps a hit to the session, turn and citation fields spec.md defines', async () => {
    const { reader, SearchHistory } = tools();
    reader.searchResult = [hit({ conversationId: 'conv-x', turn: 9, timestamp: '2026-01-11T00:00:00Z', role: 'user', type: 'text', snippet: 'a match' })];

    const expected = [{ session: 'conv-x', turn: 9, timestamp: '2026-01-11T00:00:00Z', role: 'user', type: 'text', snippet: 'a match' }];
    const actual = await call(SearchHistory, { query: 'sqlite' });
    expect(actual).toEqual(expected);
  });
});

describe('ReadHistory — mapping', () => {
  it('forwards each citation session as a conversation id with the window', async () => {
    const { reader, ReadHistory } = tools();
    await call(ReadHistory, { citations: [{ session: 'conv-x', turn: 4 }], window: 2 });

    const expected = { citations: [{ conversationId: 'conv-x', turn: 4 }], window: 2 };
    const actual = reader.readArg;
    expect(actual).toEqual(expected);
  });
});

describe('ReadHistory — shaping', () => {
  it('maps a window to session, turn and its events', async () => {
    const { reader, ReadHistory } = tools();
    reader.readResult = [window({ conversationId: 'conv-x', turn: 4, events: [{ turn: 3, timestamp: '2026-01-10T00:00:00Z', role: 'user', type: 'text', text: 'q' }] })];

    const expected = [{ session: 'conv-x', turn: 4, events: [{ turn: 3, timestamp: '2026-01-10T00:00:00Z', role: 'user', type: 'text', text: 'q' }] }];
    const actual = await call(ReadHistory, { citations: [{ session: 'conv-x', turn: 4 }] });
    expect(actual).toEqual(expected);
  });
});
