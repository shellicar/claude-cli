import { describe, expect, it } from 'vitest';
import { createRef } from '../src/Ref/Ref';
import { RefStore } from '../src/RefStore/RefStore';
import { call } from './helpers';

const makeStore = (entries: Record<string, string> = {}) => {
  const store = new RefStore();
  const ids: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    ids[key] = store.store(value, key);
  }
  return { store, ids };
};

describe('createRef — full fetch', () => {
  it('returns full content for a known ref', async () => {
    const { store, ids } = makeStore({ a: 'hello world' });
    const { tool: Ref } = createRef(store, 1000);
    const result = await call(Ref, { id: ids.a });
    // default start=0, limit=10000 — content is 11 chars so end clamps to 11
    expect(result).toMatchObject({ found: true, content: 'hello world', totalSize: 11, start: 0, end: 11 });
  });

  it('includes the hint in the response', async () => {
    const { store, ids } = makeStore({ mykey: 'some content' });
    const { tool: Ref } = createRef(store, 1000);
    const result = (await call(Ref, { id: ids.mykey })) as { found: boolean; hint: string };
    expect(result.found).toBe(true);
    expect(result.hint).toBe('mykey');
  });

  it('returns found: false for an unknown id', async () => {
    const { store } = makeStore();
    const { tool: Ref } = createRef(store, 1000);
    const result = await call(Ref, { id: 'no-such-id' });
    expect(result).toMatchObject({ found: false, id: 'no-such-id' });
  });
});

describe('createRef — slicing', () => {
  it('returns a slice when start and limit are given', async () => {
    const { store, ids } = makeStore({ a: 'abcdefghij' });
    const { tool: Ref } = createRef(store, 1000);
    const result = await call(Ref, { id: ids.a, start: 2, limit: 3 });
    expect(result).toMatchObject({ found: true, content: 'cde', totalSize: 10, start: 2, end: 5 });
  });

  it('clamps start+limit to totalSize', async () => {
    const { store, ids } = makeStore({ a: 'hello' });
    const { tool: Ref } = createRef(store, 1000);
    const result = await call(Ref, { id: ids.a, start: 0, limit: 2000 });
    expect(result).toMatchObject({ found: true, content: 'hello', totalSize: 5, end: 5 });
  });

  it('pages from a non-zero start using default limit', async () => {
    const { store, ids } = makeStore({ a: 'abcdef' });
    const { tool: Ref } = createRef(store, 1000);
    const result = await call(Ref, { id: ids.a, start: 3 });
    // limit defaults to 10000; content is 6 chars so end clamps to 6
    expect(result).toMatchObject({ found: true, content: 'def', totalSize: 6, start: 3, end: 6 });
  });

  it('default start=0, limit=10000 never dumps the whole ref for large content', async () => {
    const bigContent = 'x'.repeat(15000);
    const store = new RefStore();
    const id = store.store(bigContent);
    const { tool: Ref } = createRef(store, 10);
    const result = (await call(Ref, { id })) as { found: boolean; content: string; end: number };
    expect(result.found).toBe(true);
    expect(result.content.length).toBe(10000);
    expect(result.end).toBe(10000);
  });
});

describe('createRef — transformToolResult', () => {
  it('ref-swaps large strings from other tools', () => {
    const store = new RefStore();
    const { transformToolResult } = createRef(store, 10);
    const output = { exitCode: 0, stdout: 'x'.repeat(20) };
    const result = transformToolResult('Exec', output) as any;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchObject({ ref: expect.any(String), size: 20 });
    expect(store.count).toBe(1);
  });

  it('does not ref-swap the Ref tool\u2019s own output', () => {
    const store = new RefStore();
    const { transformToolResult } = createRef(store, 10);
    const output = { found: true, content: 'x'.repeat(20), totalSize: 20, start: 0, end: 20 };
    const result = transformToolResult('Ref', output) as any;
    // content passes through unchanged — no ref token, nothing stored
    expect(result.content).toBe('x'.repeat(20));
    expect(store.count).toBe(0);
  });

  it('passes small strings through without storing', () => {
    const store = new RefStore();
    const { transformToolResult } = createRef(store, 100);
    const output = { exitCode: 0, stdout: 'short' };
    const result = transformToolResult('Exec', output) as any;
    expect(result.stdout).toBe('short');
    expect(store.count).toBe(0);
  });
});
