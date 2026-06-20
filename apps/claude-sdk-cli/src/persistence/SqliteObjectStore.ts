import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import Database from 'better-sqlite3';

export class SqliteObjectStore extends IObjectStore {
  readonly #db: Database.Database;
  readonly #setStmt: Database.Statement;
  readonly #getStmt: Database.Statement;

  public constructor(path: string) {
    super();
    // better-sqlite3 cannot open a database in a directory that does not exist.
    mkdirSync(dirname(path), { recursive: true });
    this.#db = new Database(path);
    this.#db.pragma('journal_mode = WAL');
    this.#db.pragma('synchronous = NORMAL');
    // A second concurrent writer (two CLIs share this machine-wide store) waits up to 5s for the lock instead of throwing SQLITE_BUSY.
    this.#db.pragma('busy_timeout = 5000');
    this.#db.exec('CREATE TABLE IF NOT EXISTS objects (collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (collection, id)) WITHOUT ROWID;');
    this.#setStmt = this.#db.prepare('INSERT OR REPLACE INTO objects (collection, id, value) VALUES (?, ?, ?)');
    this.#getStmt = this.#db.prepare('SELECT value FROM objects WHERE collection = ? AND id = ?');
  }

  public set(collection: string, id: string, value: string): void {
    this.#setStmt.run(collection, id, value);
  }

  public get(collection: string, id: string): string | undefined {
    const row = this.#getStmt.get(collection, id) as { value: string } | undefined;
    return row?.value;
  }

  /** The underlying connection. Exposed so tests can read connection-level pragmas (e.g. busy_timeout) that are not persisted to the database file. */
  public get db(): Database.Database {
    return this.#db;
  }
}
