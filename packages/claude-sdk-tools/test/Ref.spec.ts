import { describe, expect, it } from 'vitest';
import { createRef } from '../src/Ref/Ref';
import { RefStore } from '../src/RefStore/RefStore';
import { call } from './helpers';

const makeStore = (entries: Record<string, string> = {}) => {
  const store = new RefStore();
  const ids: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    ids[key] = store.store(value);
  }
  return { store, ids };
};

describe('createRef u2014 full fetch', () => {
  it('returns full content for a known ref', async () => {
    const { store, ids } = makeStore({ a: 'hello world' });
    const Ref = createRef(store);
    const result = await call(Ref, { id: ids.a });
    expect(result).toMatchObject({ found: true, content: 'hello world', totalSize: 11, start: 0, end: 11 });
  });

  it('returns found: false for an unknown id', async () => {
    const { store } = makeStore();
    const Ref = createRef(store);
    const result = await call(Ref, { id: 'no-such-id' });
    expect(result).toMatchObject({ found: false, id: 'no-such-id' });
  });
});

describe('createRef u2014 slicing', () => {
  it('returns a slice when start and end are given', async () => {
    const { store, ids } = makeStore({ a: 'abcdefghij' });
    const Ref = createRef(store);
    const result = await call(Ref, { id: ids.a, start: 2, end: 5 });
    expect(result).toMatchObject({ found: true, content: 'cde', totalSize: 10, start: 2, end: 5 });
  });

  it('clamps end to totalSize', async () => {
    const { store, ids } = makeStore({ a: 'hello' });
    const Ref = createRef(store);
    const result = await call(Ref, { id: ids.a, start: 0, end: 9999 });
    expect(result).toMatchObject({ found: true, content: 'hello', totalSize: 5, end: 5 });
  });

  it('returns from start to end of content when only start is given', async () => {
    const { store, ids } = makeStore({ a: 'abcdef' });
    const Ref = createRef(store);
    const result = await call(Ref, { id: ids.a, start: 3 });
    expect(result).toMatchObject({ found: true, content: 'def', totalSize: 6, start: 3, end: 6 });
  });
});
