import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqliteObjectStore } from '../src/persistence/SqliteObjectStore.js';

let tempDir: string;
let counter = 0;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'sqlite-object-store-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const createStore = (): SqliteObjectStore => new SqliteObjectStore(join(tempDir, `store-${counter++}.db`));

describe('SqliteObjectStore — construction', () => {
  it('opens a database on disk without throwing', () => {
    const actual = () => createStore();
    expect(actual).not.toThrow();
  });
});

describe('SqliteObjectStore — round trip', () => {
  it('returns the stored value for a known id', () => {
    const store = createStore();
    store.set('ref', 'id-1', 'hello');

    const expected = 'hello';
    const actual = store.get('ref', 'id-1');
    expect(actual).toBe(expected);
  });

  it('returns undefined for an unknown id', () => {
    const store = createStore();

    const actual = store.get('ref', 'missing');
    expect(actual).toBeUndefined();
  });
});

describe('SqliteObjectStore — pragmas', () => {
  it('configures busy_timeout to 5000', () => {
    const store = createStore();

    const expected = 5000;
    const actual = store.db.pragma('busy_timeout', { simple: true });
    expect(actual).toBe(expected);
  });
});
