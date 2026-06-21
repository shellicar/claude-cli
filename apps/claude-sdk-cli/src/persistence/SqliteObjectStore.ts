import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';

export class SqliteObjectStore extends IObjectStore {
  readonly #db: DatabaseSync;
  readonly #setStmt: StatementSync;
  readonly #getStmt: StatementSync;

  public constructor(db: DatabaseSync) {
    super();
    this.#db = db;
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA synchronous = NORMAL');
    // A second concurrent writer (two CLIs share this machine-wide store) waits up to 5s for the lock instead of throwing SQLITE_BUSY.
    this.#db.exec('PRAGMA busy_timeout = 5000');
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
}
