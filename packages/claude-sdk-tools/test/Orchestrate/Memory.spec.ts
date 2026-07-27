import type { MemoryEntry } from '@shellicar/claude-core/memory/types';
import type { Stream } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createDeleteMemoryToolV2 } from '../../src/Orchestrate/tools/DeleteMemory.js';
import { createMemoryTypesToolV2 } from '../../src/Orchestrate/tools/MemoryTypes.js';
import { createReadMemoryToolV2 } from '../../src/Orchestrate/tools/ReadMemory.js';
import { createSearchMemoryToolV2 } from '../../src/Orchestrate/tools/SearchMemory.js';
import { createWriteMemoryToolV2 } from '../../src/Orchestrate/tools/WriteMemory.js';
import { RecordingMemoryStore } from '../RecordingMemoryStore.js';

async function drain(stream: Stream<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of stream) {
    out.push(value);
  }
  return out;
}

const ENTRY: MemoryEntry = { id: 'id-1', title: 't', body: 'b', type: 'trap', keywords: [], environment: {}, createdAt: 'now' };

describe('WriteMemory V2', () => {
  it('calls store.write with the given fields', async () => {
    const store = new RecordingMemoryStore();
    const tool = createWriteMemoryToolV2(store);

    await drain(tool.run({ title: 't', body: 'b', type: 'trap', keywords: [], intent: 'x' }, undefined, []).stdout);

    expect(store.writeArg).toEqual({ title: 't', body: 'b', type: 'trap', keywords: [] });
  });

  it('reports success', () => {
    const tool = createWriteMemoryToolV2(new RecordingMemoryStore());
    const { success } = tool.run({ title: 't', body: 'b', type: 'trap', keywords: [], intent: 'x' }, undefined, []);
    expect(success()).toBe(true);
  });
});

describe('ReadMemory V2', () => {
  it('reports found: false for an unknown id', async () => {
    const store = new RecordingMemoryStore();
    const tool = createReadMemoryToolV2(store);

    const lines = await drain(tool.run({ id: 'missing', intent: 'x' }, undefined, []).stdout);

    expect(JSON.parse(lines.join('\n'))).toEqual({ found: false, id: 'missing' });
  });

  it('reports the entry for a known id', async () => {
    const store = new RecordingMemoryStore();
    store.readResult = ENTRY;
    const tool = createReadMemoryToolV2(store);

    const lines = await drain(tool.run({ id: 'id-1', intent: 'x' }, undefined, []).stdout);

    expect(JSON.parse(lines.join('\n'))).toEqual({ found: true, memory: ENTRY });
  });
});

describe('SearchMemory V2', () => {
  it('passes query/type/limit to the store', async () => {
    const store = new RecordingMemoryStore();
    const tool = createSearchMemoryToolV2(store);

    await drain(tool.run({ query: 'sqlite', type: 'trap', limit: 5, intent: 'x' }, undefined, []).stdout);

    expect(store.searchArg).toEqual({ query: 'sqlite', type: 'trap', limit: 5 });
  });

  it('yields one line per hit after a count line', async () => {
    const store = new RecordingMemoryStore();
    store.searchResult = [{ ...ENTRY, score: 0.9 }];
    const tool = createSearchMemoryToolV2(store);

    const lines = await drain(tool.run({ query: 'sqlite', limit: 10, intent: 'x' }, undefined, []).stdout);

    expect(lines[0]).toBe('1 result(s)');
  });
});

describe('DeleteMemory V2', () => {
  it('calls store.delete with the id', async () => {
    const store = new RecordingMemoryStore();
    const tool = createDeleteMemoryToolV2(store);

    await drain(tool.run({ id: 'id-1', intent: 'x' }, undefined, []).stdout);

    expect(store.deleteArg).toBe('id-1');
  });
});

describe('MemoryTypes V2', () => {
  it('yields one line per type', async () => {
    const store = new RecordingMemoryStore();
    store.typesResult = [{ type: 'trap', count: 3 }];
    const tool = createMemoryTypesToolV2(store);

    const lines = await drain(tool.run({}, undefined, []).stdout);

    expect(lines).toEqual(['trap: 3']);
  });
});
