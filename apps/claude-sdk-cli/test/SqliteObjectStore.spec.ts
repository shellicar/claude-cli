import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

const createDb = (): DatabaseSync => new DatabaseSync(join(tempDir, `store-${counter++}.db`));

describe('SqliteObjectStore — construction', () => {
  it('configures an injected on-disk database without throwing', () => {
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

describe('SqliteObjectStore — pragmas', () => {
  it('configures busy_timeout to 5000 on the injected connection', () => {
    const db = createDb();
    new SqliteObjectStore(db);

    const expected = 5000;
    const actual = (db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout;
    expect(actual).toBe(expected);
  });
});
