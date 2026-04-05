import { describe, expect, it } from 'vitest';
import { RefStore } from '../src/RefStore/RefStore';

describe('RefStore — store and retrieve', () => {
  it('stores content and returns a uuid', () => {
    const store = new RefStore();
    const id = store.store('hello world');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.get(id)).toBe('hello world');
  });

  it('returns undefined for unknown id', () => {
    const store = new RefStore();
    expect(store.get('does-not-exist')).toBeUndefined();
  });

  it('tracks count and bytes', () => {
    const store = new RefStore();
    store.store('abc');
    store.store('defgh');
    expect(store.count).toBe(2);
    expect(store.bytes).toBe(8);
  });

  it('deletes entries', () => {
    const store = new RefStore();
    const id = store.store('hello');
    store.delete(id);
    expect(store.get(id)).toBeUndefined();
    expect(store.count).toBe(0);
  });
});

describe('RefStore.walkAndRef — passthrough', () => {
  it('passes through short strings unchanged', () => {
    const store = new RefStore();
    expect(store.walkAndRef('short', 100)).toBe('short');
  });

  it('passes through numbers unchanged', () => {
    const store = new RefStore();
    expect(store.walkAndRef(42, 10)).toBe(42);
  });

  it('passes through booleans unchanged', () => {
    const store = new RefStore();
    expect(store.walkAndRef(true, 10)).toBe(true);
  });

  it('passes through null unchanged', () => {
    const store = new RefStore();
    expect(store.walkAndRef(null, 10)).toBeNull();
  });
});

describe('RefStore.walkAndRef — string replacement', () => {
  it('replaces a string exceeding threshold with a ref token', () => {
    const store = new RefStore();
    const large = 'x'.repeat(101);
    const result = store.walkAndRef(large, 100) as { ref: string; size: number };
    expect(result).toMatchObject({ ref: expect.any(String), size: 101 });
    expect(store.get(result.ref)).toBe(large);
  });

  it('does not replace a string exactly at the threshold', () => {
    const store = new RefStore();
    const exact = 'x'.repeat(100);
    expect(store.walkAndRef(exact, 100)).toBe(exact);
  });
});

describe('RefStore.walkAndRef — object tree', () => {
  it('replaces only the large string field, leaving small fields intact', () => {
    const store = new RefStore();
    const large = 'y'.repeat(200);
    const input = { exitCode: 0, stdout: large, stderr: '' };
    const result = store.walkAndRef(input, 100) as { exitCode: number; stdout: { ref: string; size: number }; stderr: string };

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatchObject({ ref: expect.any(String), size: 200 });
    expect(store.get(result.stdout.ref)).toBe(large);
    expect(store.count).toBe(1);
  });

  it('handles nested objects', () => {
    const store = new RefStore();
    const large = 'z'.repeat(200);
    const input = { outer: { inner: large, small: 'ok' } };
    const result = store.walkAndRef(input, 100) as { outer: { inner: { ref: string }; small: string } };

    expect(result.outer.small).toBe('ok');
    expect(result.outer.inner).toMatchObject({ ref: expect.any(String), size: 200 });
  });

  it('leaves an object with all-small values completely unchanged in shape', () => {
    const store = new RefStore();
    const input = { a: 'hello', b: 42, c: true };
    const result = store.walkAndRef(input, 100);
    expect(result).toEqual({ a: 'hello', b: 42, c: true });
    expect(store.count).toBe(0);
  });
});

describe('RefStore.walkAndRef — arrays', () => {
  it('recurses into arrays, replacing large string elements', () => {
    const store = new RefStore();
    const large = 'a'.repeat(200);
    const result = store.walkAndRef(['small', large, 42], 100) as unknown[];

    expect(result[0]).toBe('small');
    expect(result[1]).toMatchObject({ ref: expect.any(String), size: 200 });
    expect(result[2]).toBe(42);
  });

  it('does not ref small array elements', () => {
    const store = new RefStore();
    const result = store.walkAndRef(['a', 'b', 'c'], 100);
    expect(result).toEqual(['a', 'b', 'c']);
    expect(store.count).toBe(0);
  });
});
