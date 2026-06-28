import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';

export class SqliteObjectStore extends IObjectStore {
  readonly #setStmt: StatementSync;
  readonly #getStmt: StatementSync;

  public constructor(db: DatabaseSync) {
    super();
    db.exec('CREATE TABLE IF NOT EXISTS objects (collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (collection, id)) WITHOUT ROWID;');
    this.#setStmt = db.prepare('INSERT OR REPLACE INTO objects (collection, id, value) VALUES (?, ?, ?)');
    this.#getStmt = db.prepare('SELECT value FROM objects WHERE collection = ? AND id = ?');
  }

  public set(collection: string, id: string, value: string): void {
    this.#setStmt.run(collection, id, value);
  }

  public get(collection: string, id: string): string | undefined {
    const row = this.#getStmt.get(collection, id) as { value: string } | undefined;
    return row?.value;
  }
}
