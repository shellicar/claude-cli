import { describe, expect, it } from 'vitest';
import { MemoryObjectStore } from './MemoryObjectStore';

describe('MemoryObjectStore — round trip', () => {
  it('returns the stored value for a known id', () => {
    const store = new MemoryObjectStore();
    store.set('ref', 'id-1', 'hello');

    const expected = 'hello';
    const actual = store.get('ref', 'id-1');
    expect(actual).toBe(expected);
  });

  it('returns undefined for an unknown id', () => {
    const store = new MemoryObjectStore();

    const actual = store.get('ref', 'missing');
    expect(actual).toBeUndefined();
  });

  it('isolates ids that share a value across collections', () => {
    const store = new MemoryObjectStore();
    store.set('ref', 'shared', 'a');
    store.set('previewEdit', 'shared', 'b');

    const expected = 'a';
    const actual = store.get('ref', 'shared');
    expect(actual).toBe(expected);
  });

  it('overwrites an existing value', () => {
    const store = new MemoryObjectStore();
    store.set('ref', 'id-1', 'first');
    store.set('ref', 'id-1', 'second');

    const expected = 'second';
    const actual = store.get('ref', 'id-1');
    expect(actual).toBe(expected);
  });
});
