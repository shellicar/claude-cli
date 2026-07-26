import type { Stream } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createRefToolV2, RefToolV2Model } from '../../src/Orchestrate/tools/Ref.js';
import { MemoryObjectStore } from '../MemoryObjectStore.js';
import { RefStore } from '../../src/RefStore/RefStore.js';

async function drain(stream: Stream<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of stream) {
    out.push(value);
  }
  return out;
}

describe('Ref tool', () => {
  it('is none tier \u2014 an in-memory lookup, not a filesystem operation', () => {
    const tool = createRefToolV2(new RefStore(new MemoryObjectStore()));

    const expected = 'none';
    const actual = tool.operation;
    expect(actual).toBe(expected);
  });

  it('emits the stored content split into lines, so it composes with Match/Head/Tail/Range', async () => {
    const store = new RefStore(new MemoryObjectStore());
    const id = store.store('first\nsecond\nthird');
    const tool = createRefToolV2(store);

    const { stdout } = tool.run({ id, start: 0, limit: 10_000 }, undefined, []);
    const actual = await drain(stdout);

    const expected = ['first', 'second', 'third'];
    expect(actual).toEqual(expected);
  });

  it('slices by start/limit before splitting into lines, same character-paging as V1', async () => {
    const store = new RefStore(new MemoryObjectStore());
    const id = store.store('0123456789');
    const tool = createRefToolV2(store);

    const { stdout } = tool.run({ id, start: 2, limit: 4 }, undefined, []);
    const actual = await drain(stdout);

    const expected = ['2345'];
    expect(actual).toEqual(expected);
  });

  it('defaults start to 0 and limit to 10000 when omitted from the wire input', () => {
    const parsed = RefToolV2Model.parse({ id: 'some-id' });

    const expected = { id: 'some-id', start: 0, limit: 10_000 };
    const actual = parsed;
    expect(actual).toEqual(expected);
  });

  it('reports failure and a stderr message when the id is not found', async () => {
    const store = new RefStore(new MemoryObjectStore());
    const tool = createRefToolV2(store);
    const stderr: string[] = [];

    const { stdout, success } = tool.run({ id: 'missing', start: 0, limit: 10_000 }, undefined, stderr);
    await drain(stdout);

    const expected = false;
    const actual = success();
    expect(actual).toBe(expected);
  });

  it('names the missing id in the stderr message', async () => {
    const store = new RefStore(new MemoryObjectStore());
    const tool = createRefToolV2(store);
    const stderr: string[] = [];

    const { stdout } = tool.run({ id: 'missing-id', start: 0, limit: 10_000 }, undefined, stderr);
    await drain(stdout);

    const expected = ['Ref not found: missing-id'];
    const actual = stderr;
    expect(actual).toEqual(expected);
  });
});
