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

describe('createRef — full fetch', () => {
  it('returns full content for a known ref', async () => {
    const { store, ids } = makeStore({ a: 'hello world' });
    const { tool: Ref } = createRef(store, 1000);
    const result = await call(Ref, { id: ids.a });
    expect(result).toMatchObject({ found: true, content: 'hello world', totalSize: 11, start: 0, end: 11 });
  });

  it('returns found: false for an unknown id', async () => {
    const { store } = makeStore();
    const { tool: Ref } = createRef(store, 1000);
    const result = await call(Ref, { id: 'no-such-id' });
    expect(result).toMatchObject({ found: false, id: 'no-such-id' });
  });
});

describe('createRef — slicing', () => {
  it('returns a slice when start and end are given', async () => {
    const { store, ids } = makeStore({ a: 'abcdefghij' });
    const { tool: Ref } = createRef(store, 1000);
    const result = await call(Ref, { id: ids.a, start: 2, end: 5 });
    expect(result).toMatchObject({ found: true, content: 'cde', totalSize: 10, start: 2, end: 5 });
  });

  it('clamps end to totalSize', async () => {
    const { store, ids } = makeStore({ a: 'hello' });
    const { tool: Ref } = createRef(store, 1000);
    const result = await call(Ref, { id: ids.a, start: 0, end: 9999 });
    expect(result).toMatchObject({ found: true, content: 'hello', totalSize: 5, end: 5 });
  });

  it('returns from start to end of content when only start is given', async () => {
    const { store, ids } = makeStore({ a: 'abcdef' });
    const { tool: Ref } = createRef(store, 1000);
    const result = await call(Ref, { id: ids.a, start: 3 });
    expect(result).toMatchObject({ found: true, content: 'def', totalSize: 6, start: 3, end: 6 });
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

  it('does not ref-swap the Ref tool’s own output', () => {
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
