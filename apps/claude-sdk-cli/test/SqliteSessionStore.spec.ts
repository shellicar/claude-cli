import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqliteSessionStore } from '../src/persistence/SqliteSessionStore.js';

let tempDir: string;
let counter = 0;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'sqlite-session-store-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const createDb = (): DatabaseSync => new DatabaseSync(join(tempDir, `store-${counter++}.db`));

describe('SqliteSessionStore — append', () => {
  it('inserts a row carrying the conversationId, cwd, and timestamp', () => {
    const db = createDb();
    const store = new SqliteSessionStore(db);
    store.append('conv-1', '/project', '2026-07-05T00:00:00Z');

    const expected = { conversation_id: 'conv-1', cwd: '/project', created_at: '2026-07-05T00:00:00Z' };
    const actual = db.prepare('SELECT conversation_id, cwd, created_at FROM sessions').get();
    expect(actual).toEqual(expected);
  });

  it('keeps both records when the same cwd is appended twice (a log, not an upsert)', () => {
    const db = createDb();
    const store = new SqliteSessionStore(db);
    store.append('conv-1', '/project', '2026-07-05T00:00:00Z');
    store.append('conv-2', '/project', '2026-07-05T00:01:00Z');

    const expected = 2;
    const actual = (db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE cwd = ?').get('/project') as { n: number }).n;
    expect(actual).toBe(expected);
  });
});

describe('SqliteSessionStore — mostRecentByCwd', () => {
  it('returns the conversationId of the most recently appended record for the cwd', () => {
    const store = new SqliteSessionStore(createDb());
    store.append('conv-old', '/project', '2026-07-05T00:00:00Z');
    store.append('conv-new', '/project', '2026-07-05T00:01:00Z');

    const expected = 'conv-new';
    const actual = store.mostRecentByCwd('/project');
    expect(actual).toBe(expected);
  });

  it('returns undefined for a cwd with no records', () => {
    const store = new SqliteSessionStore(createDb());

    const actual = store.mostRecentByCwd('/nowhere');
    expect(actual).toBeUndefined();
  });

  it('returns the record for the asked cwd, not a more recent record under a different cwd', () => {
    const store = new SqliteSessionStore(createDb());
    store.append('conv-a', '/project-a', '2026-07-05T00:00:00Z');
    store.append('conv-b', '/project-b', '2026-07-05T00:01:00Z');

    const expected = 'conv-a';
    const actual = store.mostRecentByCwd('/project-a');
    expect(actual).toBe(expected);
  });
});
