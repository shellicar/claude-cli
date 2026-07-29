import type { DatabaseSync } from 'node:sqlite';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { type Migration, migrate, schemaVersion } from '@shellicar/claude-core/persistence/migrate';

// The session store's schema, versioned via PRAGMA user_version. Append a new entry for every change; never edit a
// shipped one. A new table is additive, so it is a MINOR bump — tolerated by an older build sharing the file.
// See CLAUDE.md "Database Schema & Migrations".
const SESSION_MIGRATIONS: readonly Migration[] = [
  {
    version: schemaVersion(1, 0),
    apply: (db) => {
      // Append-only log: one row per (conversationId, cwd) write, ordered by the autoincrement id. Resume asks for
      // the most recent row under a cwd; the log keeps history so later lifecycle events can reconstruct active
      // state at any point in time (future, additive). No lifecycle-event column yet.
      db.exec(
        `CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL,
          cwd TEXT NOT NULL,
          created_at TEXT NOT NULL
        );`,
      );
    },
  },
];

/**
 * Append-only log tying a conversation to the directory it was last live in. `append` records one row per write;
 * `mostRecentByCwd` resolves the resume target by reading the newest row for a cwd. Owns its own database file
 * (`sessions.db`) via `DatabaseFactory`; the base schema is migration 1, applied through `migrate` on construction.
 */
/** The store's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class ISqliteSessionStore {
  public abstract append(conversationId: string, cwd: string, timestamp: string): void;
  public abstract mostRecentByCwd(cwd: string): string | undefined;
  public abstract listByCwd(cwd: string): readonly string[];
}

export class SqliteSessionStore extends ISqliteSessionStore {
  readonly #db: DatabaseSync;

  public constructor(db: DatabaseSync, logger: ILogger) {
    super();
    this.#db = db;
    migrate(this.#db, SESSION_MIGRATIONS, 'sessions', logger);
  }

  public append(conversationId: string, cwd: string, timestamp: string): void {
    this.#db.prepare('INSERT INTO sessions (conversation_id, cwd, created_at) VALUES (?, ?, ?)').run(conversationId, cwd, timestamp);
  }

  public mostRecentByCwd(cwd: string): string | undefined {
    const row = this.#db.prepare('SELECT conversation_id FROM sessions WHERE cwd = ? ORDER BY id DESC LIMIT 1').get(cwd) as { conversation_id: string } | undefined;
    return row?.conversation_id;
  }

  /** Every conversation ever live under a directory, most recently written first. The log holds one row
   *  per write, so the rows are grouped and ordered by each id's newest row. */
  public listByCwd(cwd: string): readonly string[] {
    const rows = this.#db.prepare('SELECT conversation_id FROM sessions WHERE cwd = ? GROUP BY conversation_id ORDER BY MAX(id) DESC').all(cwd) as { conversation_id: string }[];
    return rows.map((row) => row.conversation_id);
  }
}
