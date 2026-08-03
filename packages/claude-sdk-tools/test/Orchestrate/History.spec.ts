import { Clock } from '@js-joda/core';
import { lines as toLines } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createReadHistoryToolV2 } from '../../src/Orchestrate/tools/ReadHistory.js';
import { createSearchHistoryToolV2 } from '../../src/Orchestrate/tools/SearchHistory.js';
import { RecordingHistoryReader } from '../RecordingHistoryReader.js';

async function drain(stream: AsyncIterable<unknown>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of toLines(stream)) {
    out.push(String(value));
  }
  return out;
}

describe('SearchHistory V2', () => {
  it('excludes the current session unless includeCurrentSession is set', async () => {
    const reader = new RecordingHistoryReader();
    const tool = createSearchHistoryToolV2(reader, () => 'session-1', Clock.systemUTC());

    await drain(tool.run({ query: 'q', limit: 10, includeCurrentSession: false }, undefined, []).stdout);

    expect(reader.searchArg?.excludeConversationId).toBe('session-1');
  });

  it('includes the current session when requested', async () => {
    const reader = new RecordingHistoryReader();
    const tool = createSearchHistoryToolV2(reader, () => 'session-1', Clock.systemUTC());

    await drain(tool.run({ query: 'q', limit: 10, includeCurrentSession: true }, undefined, []).stdout);

    expect(reader.searchArg?.excludeConversationId).toBeUndefined();
  });

  it('yields a count line followed by one line per hit', async () => {
    const reader = new RecordingHistoryReader();
    reader.searchResult = [{ conversationId: 's', turnId: 't', timestamp: 'now', role: 'user', type: 'text', snippet: 'hi', score: 1 }];
    const tool = createSearchHistoryToolV2(reader, () => 'session-1', Clock.systemUTC());

    const lines = await drain(tool.run({ query: 'q', limit: 10, includeCurrentSession: false }, undefined, []).stdout);

    expect(lines[0]).toBe('1 hit(s)');
  });
});

describe('ReadHistory V2', () => {
  it('maps session/turnId citations to the reader request', async () => {
    const reader = new RecordingHistoryReader();
    const tool = createReadHistoryToolV2(reader);

    await drain(tool.run({ citations: [{ session: 's1', turnId: 't1' }], window: 3 }, undefined, []).stdout);

    expect(reader.readArg).toEqual({ citations: [{ conversationId: 's1', turnId: 't1' }], window: 3 });
  });
});
