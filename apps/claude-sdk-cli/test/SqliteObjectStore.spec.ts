import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SqliteObjectStore } from '../src/persistence/SqliteObjectStore.js';

const createDb = (): DatabaseSync => new DatabaseSync(':memory:');

describe('SqliteObjectStore — construction', () => {
  it('configures an injected database without throwing', () => {
    const db = createDb();

    const actual = () => new SqliteObjectStore(db);
    expect(actual).not.toThrow();
  });
});

describe('SqliteObjectStore — round trip', () => {
  it('returns the stored value for a known id', () => {
    const store = new SqliteObjectStore(createDb());
    store.set('ref', 'id-1', 'hello');

    const expected = 'hello';
    const actual = store.get('ref', 'id-1');
    expect(actual).toBe(expected);
  });

  it('returns undefined for an unknown id', () => {
    const store = new SqliteObjectStore(createDb());

    const actual = store.get('ref', 'missing');
    expect(actual).toBeUndefined();
  });
});

// The connection PRAGMAs (journal_mode/synchronous/busy_timeout) moved to
// DatabaseFactory.#open — SqliteObjectStore no longer configures the connection,
// so the pragma assertion was removed with the responsibility.
