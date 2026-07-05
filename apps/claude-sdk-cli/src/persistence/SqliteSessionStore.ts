import type { DatabaseSync } from 'node:sqlite';
import { type Migration, migrate, schemaVersion } from './migrate.js';

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
export class SqliteSessionStore {
  readonly #db: DatabaseSync;

  public constructor(db: DatabaseSync) {
    this.#db = db;
    migrate(this.#db, SESSION_MIGRATIONS, 'sessions');
  }

  public append(conversationId: string, cwd: string, timestamp: string): void {}

  public mostRecentByCwd(cwd: string): string | undefined {
    return undefined;
  }
}
