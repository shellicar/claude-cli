import type { DatabaseSync } from 'node:sqlite';

/**
 * A schema version, encoded as `major * 1000 + minor`, stored in the database's `PRAGMA user_version`.
 * MINOR is additive (expand) and tolerated by older builds; MAJOR is destructive (contract) and locks them out.
 */
export const schemaVersion = (major: number, minor: number): number => major * 1000 + minor;

export type Migration = {
  /** `schemaVersion(major, minor)`. Strictly ascending across the list; never reused. */
  version: number;
  /** Applies this step's schema change. Runs inside a transaction the runner owns. */
  apply: (db: DatabaseSync) => void;
};

const majorOf = (version: number): number => Math.floor(version / 1000);
const currentVersion = (db: DatabaseSync): number => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

function assertAscending(migrations: readonly Migration[]): void {
  let previous = -1;
  for (const migration of migrations) {
    if (migration.version <= previous) {
      throw new Error(`migrations must be strictly ascending by version; saw ${migration.version} after ${previous}`);
    }
    previous = migration.version;
  }
}

/**
 * Bring a SQLite store up to the schema this build ships, recorded in `PRAGMA user_version`. Migrations are an
 * ordered, append-only list; each pending one runs in its own transaction and stamps the version on success.
 *
 * - A store at a newer MAJOR than this build is refused — a newer build wrote it. Never down-migrated.
 * - A store at a newer MINOR within this build's major is tolerated and operated against, not migrated.
 */
export function migrate(db: DatabaseSync, migrations: readonly Migration[], name: string): void {
  assertAscending(migrations);
  const target = migrations.at(-1)?.version ?? 0;
  const dbVersion = currentVersion(db);

  if (majorOf(dbVersion) > majorOf(target)) {
    throw new Error(`${name} store schema ${dbVersion} is newer than this build supports (${target}); update the package`);
  }

  const pending = migrations.filter((migration) => migration.version > dbVersion);
  if (pending.length === 0) {
    return;
  }

  for (const migration of pending) {
    db.exec('BEGIN IMMEDIATE');
    try {
      // Re-check under the write lock: another process sharing this store could have applied the same
      // migration in the gap between the pre-lock read and acquiring the lock.
      if (migration.version > currentVersion(db)) {
        migration.apply(db);
        db.exec(`PRAGMA user_version = ${migration.version}`);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
