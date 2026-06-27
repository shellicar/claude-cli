import type { MemoryEntry, MemorySearchHit } from '@shellicar/claude-core/memory/types';
import { describe, expect, it } from 'vitest';
import { createMemoryTools } from '../src/Memory/Memory';
import { call } from './helpers';
import { RecordingMemoryStore } from './RecordingMemoryStore';

function tools(store = new RecordingMemoryStore()) {
  const [WriteMemory, ReadMemory, SearchMemory, DeleteMemory, MemoryTypes] = createMemoryTools(store);
  return { store, WriteMemory, ReadMemory, SearchMemory, DeleteMemory, MemoryTypes };
}

const entry = (over: Partial<MemoryEntry> = {}): MemoryEntry => ({ id: 'm1', title: 't', body: 'b', type: 'trap', keywords: [], environment: { org: 'shellicar' }, createdAt: '2026-06-26T00:00:00Z', ...over }) satisfies MemoryEntry;

const hit = (over: Partial<MemorySearchHit> = {}): MemorySearchHit => ({ ...entry(), score: 1, ...over });

describe('WriteMemory — mapping', () => {
  it('forwards the authored fields as the draft, dropping intent', async () => {
    const { store, WriteMemory } = tools();
    await call(WriteMemory, { title: 't', body: 'b', type: 'trap', keywords: ['k'], intent: 'd' });

    const expected = { title: 't', body: 'b', type: 'trap', keywords: ['k'] };
    const actual = store.writeArg;
    expect(actual).toEqual(expected);
  });
});

describe('WriteMemory — shaping', () => {
  it('returns the entry the store assigned', async () => {
    const { store, WriteMemory } = tools();
    store.writeResult = entry({ id: 'assigned-id' });

    const expected = store.writeResult;
    const actual = await call(WriteMemory, { title: 't', body: 'b', type: 'trap', intent: 'd' });
    expect(actual).toEqual(expected);
  });
});

describe('ReadMemory — mapping', () => {
  it('forwards the id to the store', async () => {
    const { store, ReadMemory } = tools();
    await call(ReadMemory, { id: 'abc', intent: 'd' });

    const expected = 'abc';
    const actual = store.readArg;
    expect(actual).toBe(expected);
  });
});

describe('ReadMemory — shaping', () => {
  it('wraps a present memory as found', async () => {
    const { store, ReadMemory } = tools();
    store.readResult = entry({ id: 'abc' });

    const expected = { found: true, memory: store.readResult };
    const actual = await call(ReadMemory, { id: 'abc', intent: 'd' });
    expect(actual).toEqual(expected);
  });

  it('wraps an absent memory as not-found with the id', async () => {
    const { store, ReadMemory } = tools();
    store.readResult = undefined;

    const expected = { found: false, id: 'gone' };
    const actual = await call(ReadMemory, { id: 'gone', intent: 'd' });
    expect(actual).toEqual(expected);
  });

  it('surfaces the environment the store returned', async () => {
    const { store, ReadMemory } = tools();
    store.readResult = entry({ environment: { org: 'shellicar', repo: 'claude-cli' } });

    const result = await call(ReadMemory, { id: 'm1', intent: 'd' });
    const expected = { org: 'shellicar', repo: 'claude-cli' };
    const actual = result.found ? result.memory.environment : undefined;
    expect(actual).toEqual(expected);
  });
});

describe('SearchMemory — mapping', () => {
  it('forwards query, type and limit to the store', async () => {
    const { store, SearchMemory } = tools();
    await call(SearchMemory, { query: 'sqlite', type: 'trap', limit: 5, intent: 'd' });

    const expected = { query: 'sqlite', type: 'trap', limit: 5 };
    const actual = store.searchArg;
    expect(actual).toEqual(expected);
  });
});

describe('SearchMemory — shaping', () => {
  it('wraps the hits as count plus results', async () => {
    const { store, SearchMemory } = tools();
    store.searchResult = [hit({ id: 'a' }), hit({ id: 'b' })];

    const expected = { count: 2, results: store.searchResult };
    const actual = await call(SearchMemory, { query: 'x', intent: 'd' });
    expect(actual).toEqual(expected);
  });
});

describe('DeleteMemory — mapping', () => {
  it('forwards the id to the store', async () => {
    const { store, DeleteMemory } = tools();
    await call(DeleteMemory, { id: 'abc', intent: 'd' });

    const expected = 'abc';
    const actual = store.deleteArg;
    expect(actual).toBe(expected);
  });
});

describe('DeleteMemory — shaping', () => {
  it('returns the literal delete result with the id', async () => {
    const { DeleteMemory } = tools();

    const expected = { deleted: true, id: 'abc' };
    const actual = await call(DeleteMemory, { id: 'abc', intent: 'd' });
    expect(actual).toEqual(expected);
  });
});

describe('MemoryTypes — shaping', () => {
  it('wraps the store counts under types', async () => {
    const { store, MemoryTypes } = tools();
    store.typesResult = [{ type: 'trap', count: 2 }];

    const expected = { types: [{ type: 'trap', count: 2 }] };
    const actual = await call(MemoryTypes, {});
    expect(actual).toEqual(expected);
  });
});
