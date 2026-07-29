import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { ConversationSummaryLoader } from '../src/conversations/ConversationSummaryLoader.js';
import { ConversationListState, IConversationListState } from '../src/model/ConversationListState.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

const noopLogger: ILogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const auditFor = (id: string): string => `/home/user/.claude/audit/${id}.jsonl`;

const auditContent = (text: string, costUsd: number): string =>
  [
    JSON.stringify({ role: 'user', turnId: 'turn-1', queryId: 'query-1', timestamp: '2026-07-28T10:00:00.000Z', content: [{ type: 'text', text }] }),
    JSON.stringify({ timestamp: '2026-07-28T10:01:00.000Z', costUsd, model: 'claude-sonnet-5', role: 'assistant', content: [{ type: 'text', text: 'the reply' }], usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 }, turnId: 'turn-1', queryId: 'query-1' }),
  ].join('\n');

function makeLoader(files: Record<string, string>) {
  const fs = new MemoryFileSystem(files, '/home/user', '/project');
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(IFileSystem)
    .using(() => fs)
    .asSelf();
  services
    .register(ILogger)
    .using(() => noopLogger)
    .asSelf();
  services.register(ConversationListState).asSelf().as(IConversationListState);
  services.register(ConversationSummaryLoader).asSelf();
  const provider = services.buildProvider();
  return { loader: provider.resolve(ConversationSummaryLoader), listState: provider.resolve(ConversationListState), fs };
}

/** Lets every queued read settle, since the loader walks one file per tick. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

describe('ConversationSummaryLoader', () => {
  it('fills in the summary for a listed conversation', async () => {
    const { loader, listState } = makeLoader({ [auditFor('conv-a')]: auditContent('the opening ask', 3.5) });
    listState.setEntries(['conv-a']);
    loader.load(['conv-a']);
    await settle();
    const expected = 3.5;
    const actual = listState.entries[0]?.summary?.costUsd;
    expect(actual).toBe(expected);
  });

  it('fills in every listed conversation', async () => {
    const { loader, listState } = makeLoader({ [auditFor('conv-a')]: auditContent('first', 1), [auditFor('conv-b')]: auditContent('second', 2) });
    listState.setEntries(['conv-a', 'conv-b']);
    loader.load(['conv-a', 'conv-b']);
    await settle();
    const expected = 2;
    const actual = listState.entries[1]?.summary?.costUsd;
    expect(actual).toBe(expected);
  });

  it('reads the opening ask into the summary', async () => {
    const { loader, listState } = makeLoader({ [auditFor('conv-a')]: auditContent('so after all this time', 1) });
    listState.setEntries(['conv-a']);
    loader.load(['conv-a']);
    await settle();
    const expected = 'so after all this time';
    const actual = listState.entries[0]?.summary?.firstUserText;
    expect(actual).toBe(expected);
  });

  it('summarises a conversation with no audit file as empty rather than leaving it unfilled', async () => {
    const { loader, listState } = makeLoader({});
    listState.setEntries(['conv-a']);
    loader.load(['conv-a']);
    await settle();
    const expected = 0;
    const actual = listState.entries[0]?.summary?.turns;
    expect(actual).toBe(expected);
  });

  it('serves an unchanged conversation from cache without re-reading', async () => {
    const { loader, listState, fs } = makeLoader({ [auditFor('conv-a')]: auditContent('the opening ask', 3.5) });
    listState.setEntries(['conv-a']);
    loader.load(['conv-a']);
    await settle();
    await fs.writeFile(auditFor('conv-a'), auditContent('rewritten identically', 9.9).slice(0, auditContent('the opening ask', 3.5).length));
    loader.load(['conv-a']);
    await settle();
    const expected = 3.5;
    const actual = listState.entries[0]?.summary?.costUsd;
    expect(actual).toBe(expected);
  });

  it('re-reads a conversation whose audit file has grown', async () => {
    const { loader, listState, fs } = makeLoader({ [auditFor('conv-a')]: auditContent('the opening ask', 3.5) });
    listState.setEntries(['conv-a']);
    loader.load(['conv-a']);
    await settle();
    await fs.writeFile(
      auditFor('conv-a'),
      `${auditContent('the opening ask', 3.5)}\n${JSON.stringify({ timestamp: '2026-07-28T10:02:00.000Z', costUsd: 1.5, model: 'claude-sonnet-5', role: 'assistant', content: [{ type: 'text', text: 'a later reply' }], usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, turnId: 'turn-2', queryId: 'query-1' })}`,
    );
    loader.load(['conv-a']);
    await settle();
    const expected = 5;
    const actual = listState.entries[0]?.summary?.costUsd;
    expect(actual).toBe(expected);
  });

  it('stops reading the rest of a list once a newer one is loaded', async () => {
    const { loader, listState } = makeLoader({ [auditFor('conv-a')]: auditContent('first', 1), [auditFor('conv-b')]: auditContent('second', 2) });
    listState.setEntries(['conv-a', 'conv-b']);
    loader.load(['conv-a', 'conv-b']);
    loader.load([]);
    await settle();
    const actual = listState.entries[1]?.summary;
    expect(actual).toBeUndefined();
  });
});
