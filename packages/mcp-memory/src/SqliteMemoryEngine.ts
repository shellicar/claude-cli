import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { MemoryDraft, MemoryEntry, MemoryEnvironment, MemorySearchHit, MemorySearchQuery, MemoryTypeCount } from '@shellicar/claude-core/memory/types';
import { toFtsMatch } from '@shellicar/claude-core/search';
import { type Migration, migrate, schemaVersion } from './migrate.js';

type MemoryRow = {
  id: string;
  title: string;
  body: string;
  keywords_json: string;
  type: string;
  environment: string;
  created_at: string;
};

// Column order fixes the bm25() weight positions: title, body, keywords are columns 0,1,2.
const BM25_WEIGHTS = '10.0, 1.0, 4.0';

const MEMORY_MIGRATIONS: readonly Migration[] = [
  {
    version: schemaVersion(1, 0),
    apply: (db) => {
      db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS memories USING fts5(
          title, body, keywords,
          id UNINDEXED, type UNINDEXED, keywords_json UNINDEXED,
          environment UNINDEXED, created_at UNINDEXED,
          tokenize = 'porter unicode61'
        );`,
      );
      db.exec('CREATE TABLE IF NOT EXISTS memory_index (id TEXT PRIMARY KEY, fts_rowid INTEGER NOT NULL);');
      db.exec(
        `CREATE TABLE IF NOT EXISTS memories_archive (
          id TEXT PRIMARY KEY, title TEXT, body TEXT, keywords_json TEXT,
          type TEXT, environment TEXT, created_at TEXT, deleted_at TEXT
        );`,
      );
      db.exec('INSERT OR IGNORE INTO memory_index (id, fts_rowid) SELECT id, rowid FROM memories;');
    },
  },
];

export class SqliteMemoryEngine {
  readonly #db: DatabaseSync;
  readonly #insert: StatementSync;
  readonly #insertIndex: StatementSync;
  readonly #getById: StatementSync;
  readonly #archiveById: StatementSync;
  readonly #deleteFromMemories: StatementSync;
  readonly #deleteFromIndex: StatementSync;
  readonly #typeCounts: StatementSync;

  public constructor(db: DatabaseSync) {
    this.#db = db;
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA synchronous = NORMAL');
    this.#db.exec('PRAGMA busy_timeout = 5000');
    migrate(this.#db, MEMORY_MIGRATIONS, 'memory');

    this.#insert = this.#db.prepare(
      `INSERT INTO memories (title, body, keywords, id, type, keywords_json, environment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.#insertIndex = this.#db.prepare('INSERT INTO memory_index (id, fts_rowid) VALUES (?, ?)');
    this.#getById = this.#db.prepare(
      `SELECT m.id, m.title, m.body, m.keywords_json, m.type, m.environment, m.created_at
       FROM memories m JOIN memory_index x ON x.fts_rowid = m.rowid
       WHERE x.id = ?`,
    );
    this.#archiveById = this.#db.prepare(
      `INSERT INTO memories_archive (id, title, body, keywords_json, type, environment, created_at, deleted_at)
       SELECT m.id, m.title, m.body, m.keywords_json, m.type, m.environment, m.created_at, ?
       FROM memories m JOIN memory_index x ON x.fts_rowid = m.rowid
       WHERE x.id = ?`,
    );
    this.#deleteFromMemories = this.#db.prepare('DELETE FROM memories WHERE rowid = (SELECT fts_rowid FROM memory_index WHERE id = ?)');
    this.#deleteFromIndex = this.#db.prepare('DELETE FROM memory_index WHERE id = ?');
    this.#typeCounts = this.#db.prepare('SELECT type, COUNT(*) AS count FROM memories GROUP BY type ORDER BY count DESC, type ASC');
  }

  public write(draft: MemoryDraft, environment: MemoryEnvironment): MemoryEntry {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const stamped = { ...environment };
    this.#transaction(() => {
      const info = this.#insert.run(draft.title, draft.body, draft.keywords.join(' '), id, draft.type, JSON.stringify(draft.keywords), JSON.stringify(stamped), createdAt);
      this.#insertIndex.run(id, info.lastInsertRowid);
    });
    return { id, title: draft.title, body: draft.body, keywords: draft.keywords, type: draft.type, environment: stamped, createdAt };
  }

  public read(id: string): MemoryEntry | undefined {
    const row = this.#getById.get(id) as MemoryRow | undefined;
    return row === undefined ? undefined : this.#toEntry(row);
  }

  public search(query: MemorySearchQuery): MemorySearchHit[] {
    const match = toFtsMatch(query.query);
    if (match === null) {
      return [];
    }
    const typeFilter = query.type === undefined ? '' : 'AND type = ?';
    const stmt = this.#db.prepare(
      `SELECT id, title, body, keywords_json, type, environment, created_at, bm25(memories, ${BM25_WEIGHTS}) AS rank
       FROM memories
       WHERE memories MATCH ? ${typeFilter}
       ORDER BY rank ASC
       LIMIT ?`,
    );
    const params = query.type === undefined ? [match, query.limit] : [match, query.type, query.limit];
    const rows = stmt.all(...params) as Array<MemoryRow & { rank: number }>;
    return rows.map((row) => ({ ...this.#toEntry(row), score: -row.rank }));
  }

  public delete(id: string): void {
    this.#transaction(() => {
      const deletedAt = new Date().toISOString();
      const archived = this.#archiveById.run(deletedAt, id).changes;
      if (archived === 0) {
        return;
      }
      this.#deleteFromMemories.run(id);
      this.#deleteFromIndex.run(id);
    });
  }

  public types(): MemoryTypeCount[] {
    return (this.#typeCounts.all() as Array<{ type: string; count: number }>).map((r) => ({ type: r.type, count: r.count }));
  }

  #transaction<T>(fn: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  #toEntry(row: MemoryRow): MemoryEntry {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      keywords: JSON.parse(row.keywords_json) as string[],
      type: row.type,
      environment: JSON.parse(row.environment) as MemoryEnvironment,
      createdAt: row.created_at,
    };
  }
}
