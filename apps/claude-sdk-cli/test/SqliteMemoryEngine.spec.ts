import { DatabaseSync } from 'node:sqlite';
import { Clock, Instant, ZoneId } from '@js-joda/core';
import { describe, expect, it } from 'vitest';
import { SqliteMemoryEngine } from '../src/persistence/SqliteMemoryEngine.js';
import { RecordingLogger } from './RecordingLogger.js';

const clock = Clock.fixed(Instant.parse('2026-06-26T00:00:00Z'), ZoneId.UTC);

function engine() {
  return new SqliteMemoryEngine(new DatabaseSync(':memory:'), clock, new RecordingLogger());
}

describe('SqliteMemoryEngine — relevance', () => {
  it('ranks the title match above the body-only match', () => {
    const e = engine();
    e.write({ title: 'unrelated note', body: 'mentions sqlite once', type: 'trap', keywords: [] }, {});
    e.write({ title: 'sqlite startup trap', body: 'how the store opens', type: 'trap', keywords: [] }, {});

    const expected = 'sqlite startup trap';
    const actual = e.search({ query: 'sqlite', limit: 10 })[0].title;
    expect(actual).toBe(expected);
  });
});

describe('SqliteMemoryEngine — per-write environment', () => {
  it('stamps the environment passed to that write, not a shared one', () => {
    const e = engine();
    const a = e.write({ title: 'a', body: 'b', type: 'trap', keywords: [] }, { org: 'one' });
    const b = e.write({ title: 'c', body: 'd', type: 'trap', keywords: [] }, { org: 'two' });

    const expected = [{ org: 'one' }, { org: 'two' }];
    const actual = [a.environment, b.environment];
    expect(actual).toEqual(expected);
  });
});

describe('SqliteMemoryEngine — stemming', () => {
  it('matches a stemmed term (porter)', () => {
    const e = engine();
    e.write({ title: 'releasing the beta', body: 'b', type: 'decision', keywords: [] }, {});

    const expected = 1;
    const actual = e.search({ query: 'release', limit: 10 }).length;
    expect(actual).toBe(expected);
  });
});

describe('SqliteMemoryEngine — soft delete', () => {
  it('does not return a deleted memory from search', () => {
    const e = engine();
    const m = e.write({ title: 'sqlite trap', body: 'b', type: 'trap', keywords: [] }, {});
    e.delete(m.id);

    const expected = 0;
    const actual = e.search({ query: 'sqlite', limit: 10 }).length;
    expect(actual).toBe(expected);
  });

  it('returns undefined when reading a deleted memory', () => {
    const e = engine();
    const m = e.write({ title: 't', body: 'b', type: 'trap', keywords: [] }, {});
    e.delete(m.id);

    const actual = e.read(m.id);
    expect(actual).toBeUndefined();
  });

  it('soft-deleting an unknown id does not throw', () => {
    const e = engine();
    const actual = () => e.delete('missing');
    expect(actual).not.toThrow();
  });
});

describe('SqliteMemoryEngine — input safety', () => {
  const adversarial = ['hello -world', '"quoted phrase"', 'a OR b', 'a AND b', 'NEAR(x y)', 'star*', '(paren)', '-', 'a NOT b'];

  for (const query of adversarial) {
    it(`treats ${JSON.stringify(query)} as plain terms without error`, () => {
      const e = engine();
      e.write({ title: 'hello world', body: 'a b x y star paren quoted phrase', type: 'note', keywords: [] }, {});

      const actual = e.search({ query, limit: 10 });
      expect(Array.isArray(actual)).toBe(true); // the assertion that matters is "no throw"
    });
  }

  it('treats "hello -world" as a plain word, not a NOT operator', () => {
    const e = engine();
    e.write({ title: 'hello there', body: 'nothing else', type: 'note', keywords: [] }, {});

    const expected = 1; // 'world' is a plain term (no match); 'hello' alone still returns the row
    const actual = e.search({ query: 'hello -world', limit: 10 }).length;
    expect(actual).toBe(expected);
  });
});

describe('SqliteMemoryEngine — read by id', () => {
  it('reads the memory matching the id, not another row', () => {
    const e = engine();
    const a = e.write({ title: 'first', body: 'b', type: 'note', keywords: [] }, {});
    e.write({ title: 'second', body: 'd', type: 'note', keywords: [] }, {});

    const expected = 'first';
    const actual = e.read(a.id)?.title;
    expect(actual).toBe(expected);
  });
});

describe('SqliteMemoryEngine — delete preserves data', () => {
  it('keeps the deleted memory in the archive', () => {
    const db = new DatabaseSync(':memory:');
    const e = new SqliteMemoryEngine(db, clock, new RecordingLogger());
    const m = e.write({ title: 'archived note', body: 'b', type: 'trap', keywords: [] }, {});
    e.delete(m.id);

    const expected = 'archived note';
    const actual = (db.prepare('SELECT title FROM memories_archive WHERE id = ?').get(m.id) as { title: string }).title;
    expect(actual).toBe(expected);
  });

  it('deleting the same id twice does not throw', () => {
    const e = engine();
    const m = e.write({ title: 't', body: 'b', type: 'trap', keywords: [] }, {});
    e.delete(m.id);

    const actual = () => e.delete(m.id);
    expect(actual).not.toThrow();
  });
});

describe('SqliteMemoryEngine — types', () => {
  it('counts live memories by type', () => {
    const e = engine();
    e.write({ title: 'a', body: 'b', type: 'trap', keywords: [] }, {});
    e.write({ title: 'c', body: 'd', type: 'trap', keywords: [] }, {});
    e.write({ title: 'e', body: 'f', type: 'decision', keywords: [] }, {});

    const expected = [
      { type: 'trap', count: 2 },
      { type: 'decision', count: 1 },
    ];
    const actual = e.types();
    expect(actual).toEqual(expected);
  });
});

describe('SqliteMemoryEngine — types excludes deleted', () => {
  it('stops counting a memory once it is deleted', () => {
    const e = engine();
    const m = e.write({ title: 'a', body: 'b', type: 'trap', keywords: [] }, {});
    e.write({ title: 'c', body: 'd', type: 'trap', keywords: [] }, {});
    e.delete(m.id);

    const expected = [{ type: 'trap', count: 1 }];
    const actual = e.types();
    expect(actual).toEqual(expected);
  });
});

describe('SqliteMemoryEngine — index integrity', () => {
  it('removes the id-to-rowid map entry on delete', () => {
    const db = new DatabaseSync(':memory:');
    const e = new SqliteMemoryEngine(db, clock, new RecordingLogger());
    const m = e.write({ title: 't', body: 'b', type: 'trap', keywords: [] }, {});
    e.delete(m.id);

    const expected = 0;
    const actual = (db.prepare('SELECT COUNT(*) AS n FROM memory_index WHERE id = ?').get(m.id) as { n: number }).n;
    expect(actual).toBe(expected);
  });

  it('keeps the live table and the id map in agreement after writes', () => {
    const db = new DatabaseSync(':memory:');
    const e = new SqliteMemoryEngine(db, clock, new RecordingLogger());
    e.write({ title: 'a', body: 'b', type: 'note', keywords: [] }, {});
    e.write({ title: 'c', body: 'd', type: 'note', keywords: [] }, {});

    const expected = (db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).n;
    const actual = (db.prepare('SELECT COUNT(*) AS n FROM memory_index').get() as { n: number }).n;
    expect(actual).toBe(expected);
  });
});
