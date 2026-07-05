import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { dependsOn } from '@shellicar/core-di-lite';
import { IDatabaseOptions } from './IDatabaseOptions.js';

/**
 * Owns where SQLite databases live and how they open. Consumers ask for a
 * database by name (`getDatabase('persistence.db')`); the factory memoises one
 * connection per name in `#cache`, so same-name callers share a connection
 * (which is why `:memory:` matches disk — two independent `:memory:` opens are
 * isolated). On-disk vs `:memory:` is the factory's own concern, set by the
 * injected `IDatabaseOptions`.
 *
 * The cache is not deferred wiring: the first `getDatabase` for each name runs
 * when its owning store is resolved — at `buildProvider` — so an open error
 * still surfaces at boot. Each named database has a single owning store (a DI
 * singleton); everyone else goes through that store.
 */
export class DatabaseFactory {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(IDatabaseOptions) private readonly options!: IDatabaseOptions;
  readonly #cache = new Map<string, DatabaseSync>();

  public getDatabase(name: string): DatabaseSync {
    let db = this.#cache.get(name);
    if (db === undefined) {
      db = this.#open(name);
      this.#cache.set(name, db);
    }
    return db;
  }

  #open(name: string): DatabaseSync {
    if (this.options.inMemory) {
      return new DatabaseSync(':memory:');
    }
    const path = `${this.fs.homedir()}/.claude/${name}`;
    // node:sqlite cannot open a database in a directory that does not exist.
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    // Set busy_timeout first: every statement after this — including the one-time
    // delete→wal switch on a fresh file — waits up to 5s for the lock instead of
    // throwing SQLITE_BUSY when many CLIs open the same store at once.
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA journal_mode = WAL');
    return db;
  }
}
