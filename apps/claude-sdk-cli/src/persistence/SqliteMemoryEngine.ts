import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { type Clock, Instant } from '@js-joda/core';
import { toFtsMatch } from '@shellicar/claude-core/memory/search';
import type { MemoryDraft, MemoryEntry, MemoryEnvironment, MemorySearchHit, MemorySearchQuery, MemoryTypeCount } from '@shellicar/claude-core/memory/types';

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

export class SqliteMemoryEngine {
  readonly #db: DatabaseSync;
  readonly #clock: Clock;
  readonly #insert: StatementSync;
  readonly #getById: StatementSync;
  readonly #softDelete: StatementSync;
  readonly #typeCounts: StatementSync;

  public constructor(db: DatabaseSync, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA synchronous = NORMAL');
    // Two CLIs share this machine-wide store; a second writer waits for the lock instead of throwing SQLITE_BUSY.
    this.#db.exec('PRAGMA busy_timeout = 5000');
    // Constructing the table runs CREATE VIRTUAL TABLE … USING fts5 — the earliest-signal check that FTS5 is present on this Node.
    this.#db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS memories USING fts5(
        title, body, keywords,
        id UNINDEXED, type UNINDEXED, keywords_json UNINDEXED,
        environment UNINDEXED, created_at UNINDEXED, deleted_at UNINDEXED,
        tokenize = 'porter unicode61'
      );`,
    );
    this.#insert = this.#db.prepare(
      `INSERT INTO memories (title, body, keywords, id, type, keywords_json, environment, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.#getById = this.#db.prepare(
      `SELECT id, title, body, keywords_json, type, environment, created_at
       FROM memories WHERE id = ? AND deleted_at IS NULL`,
    );
    this.#softDelete = this.#db.prepare('UPDATE memories SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL');
    this.#typeCounts = this.#db.prepare('SELECT type, COUNT(*) AS count FROM memories WHERE deleted_at IS NULL GROUP BY type ORDER BY count DESC, type ASC');
  }

  public write(draft: MemoryDraft, environment: MemoryEnvironment): MemoryEntry {
    const id = randomUUID();
    const createdAt = Instant.now(this.#clock).toString();
    const stamped = { ...environment };
    this.#insert.run(draft.title, draft.body, draft.keywords.join(' '), id, draft.type, JSON.stringify(draft.keywords), JSON.stringify(stamped), createdAt);
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
       WHERE memories MATCH ? AND deleted_at IS NULL ${typeFilter}
       ORDER BY rank ASC
       LIMIT ?`,
    );
    const params = query.type === undefined ? [match, query.limit] : [match, query.type, query.limit];
    const rows = stmt.all(...params) as Array<MemoryRow & { rank: number }>;
    return rows.map((row) => ({ ...this.#toEntry(row), score: -row.rank }));
  }

  public delete(id: string): void {
    // Idempotent: 0 rows updated (unknown or already-deleted) is success. No read-back, no throw.
    this.#softDelete.run(Instant.now(this.#clock).toString(), id);
  }

  public types(): MemoryTypeCount[] {
    return (this.#typeCounts.all() as Array<{ type: string; count: number }>).map((r) => ({ type: r.type, count: r.count }));
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
