import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { type Clock, Instant } from '@js-joda/core';
import { toFtsMatch } from '@shellicar/claude-core/memory/search';
import type { MemoryDraft, MemoryEntry, MemoryEnvironment, MemorySearchHit, MemorySearchQuery, MemoryTypeCount } from '@shellicar/claude-core/memory/types';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { type Migration, migrate, schemaVersion } from '@shellicar/claude-core/persistence/migrate';

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
// title (10) ranks above keywords (4) above body (1) — the SC's ordering principle; the numbers are mine.
const BM25_WEIGHTS = '10.0, 1.0, 4.0';

// The memory store's schema, versioned via PRAGMA user_version. Append a new entry for every change; never edit a
// shipped one. A MINOR bump (additive) is tolerated by older builds; a MAJOR bump (destructive) locks them out.
// See CLAUDE.md "Database Schema & Migrations".
const MEMORY_MIGRATIONS: readonly Migration[] = [
  {
    version: schemaVersion(1, 0),
    apply: (db) => {
      // CREATE VIRTUAL TABLE … USING fts5 doubles as the earliest-signal check that FTS5 is present on this Node.
      // No deleted_at column: a deleted memory leaves this table entirely (moved to memories_archive), so it never
      // lingers in the FTS index nudging the bm25 corpus stats. Recoverability lives in the archive, not a tombstone.
      db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS memories USING fts5(
          title, body, keywords,
          id UNINDEXED, type UNINDEXED, keywords_json UNINDEXED,
          environment UNINDEXED, created_at UNINDEXED,
          tokenize = 'porter unicode61'
        );`,
      );
      // id is UNINDEXED in the FTS5 table, so WHERE id = ? is a full scan. This map gives read/delete a PK lookup.
      db.exec('CREATE TABLE IF NOT EXISTS memory_index (id TEXT PRIMARY KEY, fts_rowid INTEGER NOT NULL);');
      // Deleted memories land here intact (never searched): the "no data lost" guarantee and a future restore's source.
      db.exec(
        `CREATE TABLE IF NOT EXISTS memories_archive (
          id TEXT PRIMARY KEY, title TEXT, body TEXT, keywords_json TEXT,
          type TEXT, environment TEXT, created_at TEXT, deleted_at TEXT
        );`,
      );
      // Backfill the map for any memories rows that pre-date it.
      db.exec('INSERT OR IGNORE INTO memory_index (id, fts_rowid) SELECT id, rowid FROM memories;');
    },
  },
];

export class SqliteMemoryEngine {
  readonly #db: DatabaseSync;
  readonly #clock: Clock;
  readonly #insert: StatementSync;
  readonly #insertIndex: StatementSync;
  readonly #getById: StatementSync;
  readonly #archiveById: StatementSync;
  readonly #deleteFromMemories: StatementSync;
  readonly #deleteFromIndex: StatementSync;
  readonly #typeCounts: StatementSync;

  public constructor(db: DatabaseSync, clock: Clock, logger: ILogger) {
    this.#db = db;
    this.#clock = clock;
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA synchronous = NORMAL');
    // Two CLIs share this machine-wide store; a second writer waits for the lock instead of throwing SQLITE_BUSY.
    this.#db.exec('PRAGMA busy_timeout = 5000');
    // Bring the schema up to the version this build ships (PRAGMA user_version). The base schema is migration 1.
    // See migrate.ts and CLAUDE.md "Database Schema & Migrations".
    migrate(this.#db, MEMORY_MIGRATIONS, 'memory', logger);

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
    const createdAt = Instant.now(this.#clock).toString();
    const stamped = { ...environment };
    // memories insert + index insert are one unit: the map can never disagree with the table about which rows exist.
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
    // bm25() returns a more-negative number for a better match; ORDER BY rank ASC puts the best first, and we negate so a higher score reads as "more relevant" for Claude.
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
    // Atomic and non-destructive: the row is copied into the archive and removed from the live table (and its index entry) as
    // one transaction. There is no observable "archived but still present" state — a failure mid-way rolls the whole thing back,
    // leaving the memory exactly where it was. Idempotent: an unknown or already-deleted id archives nothing and deletes nothing.
    this.#transaction(() => {
      const deletedAt = Instant.now(this.#clock).toString();
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
    // BEGIN IMMEDIATE takes the write lock upfront, so on the shared store a second writer waits (busy_timeout) rather than
    // failing partway through a multi-statement change.
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
