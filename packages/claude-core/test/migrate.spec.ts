import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { ILogger } from '../src/logging/ILogger';
import { type Migration, migrate, schemaVersion } from '../src/persistence/migrate';

const userVersion = (db: DatabaseSync): number => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

const noopLogger: ILogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe('migrate — stamping', () => {
  it('stamps user_version to the latest applied migration', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, [{ version: schemaVersion(1, 0), apply: () => {} }], 'test', noopLogger);

    const expected = schemaVersion(1, 0);
    const actual = userVersion(db);
    expect(actual).toBe(expected);
  });
});

describe('migrate — applying', () => {
  it('runs a pending migration', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, [{ version: schemaVersion(1, 0), apply: (d) => d.exec('CREATE TABLE marker (n INTEGER)') }], 'test', noopLogger);

    const expected = 'marker';
    const actual = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='marker'").get() as { name: string }).name;
    expect(actual).toBe(expected);
  });

  it('does not re-run a migration already applied', () => {
    const db = new DatabaseSync(':memory:');
    let runs = 0;
    const migrations: Migration[] = [
      {
        version: schemaVersion(1, 0),
        apply: () => {
          runs += 1;
        },
      },
    ];
    migrate(db, migrations, 'test', noopLogger);
    migrate(db, migrations, 'test', noopLogger);

    const expected = 1;
    const actual = runs;
    expect(actual).toBe(expected);
  });

  it('applies multiple migrations in ascending order', () => {
    const db = new DatabaseSync(':memory:');
    const order: number[] = [];
    migrate(
      db,
      [
        { version: schemaVersion(1, 0), apply: () => order.push(0) },
        { version: schemaVersion(1, 1), apply: () => order.push(1) },
      ],
      'test',
      noopLogger,
    );

    const expected = [0, 1];
    const actual = order;
    expect(actual).toEqual(expected);
  });
});

describe('migrate — version compatibility', () => {
  it('tolerates a store at a newer minor within the same major', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${schemaVersion(1, 5)}`);

    const actual = () =>
      migrate(
        db,
        [
          {
            version: schemaVersion(1, 0),
            apply: () => {
              throw new Error('must not run against a newer minor');
            },
          },
        ],
        'test',
        noopLogger,
      );
    expect(actual).not.toThrow();
  });

  it('does not down-migrate a newer-minor store', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${schemaVersion(1, 5)}`);
    migrate(db, [{ version: schemaVersion(1, 0), apply: () => {} }], 'test', noopLogger);

    const expected = schemaVersion(1, 5);
    const actual = userVersion(db);
    expect(actual).toBe(expected);
  });

  it('refuses a store at a newer major', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${schemaVersion(2, 0)}`);

    const actual = () => migrate(db, [{ version: schemaVersion(1, 0), apply: () => {} }], 'test', noopLogger);
    expect(actual).toThrow();
  });

  it('leaves user_version unchanged when the schema is already up to date', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, [{ version: schemaVersion(1, 0), apply: () => {} }], 'test', noopLogger);
    migrate(db, [{ version: schemaVersion(1, 0), apply: () => {} }], 'test', noopLogger);

    const expected = schemaVersion(1, 0);
    const actual = userVersion(db);
    expect(actual).toBe(expected);
  });

  it('does not modify user_version when refusing a store at a newer major', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${schemaVersion(2, 0)}`);
    try {
      migrate(db, [{ version: schemaVersion(1, 0), apply: () => {} }], 'test', noopLogger);
    } catch {}

    const expected = schemaVersion(2, 0);
    const actual = userVersion(db);
    expect(actual).toBe(expected);
  });
});

describe('migrate — transactional', () => {
  it('leaves user_version unchanged when a migration throws', () => {
    const db = new DatabaseSync(':memory:');
    try {
      migrate(
        db,
        [
          {
            version: schemaVersion(1, 0),
            apply: () => {
              throw new Error('boom');
            },
          },
        ],
        'test',
        noopLogger,
      );
    } catch {}

    const expected = 0;
    const actual = userVersion(db);
    expect(actual).toBe(expected);
  });
});

describe('migrate — ordering', () => {
  it('rejects a non-ascending migration list', () => {
    const db = new DatabaseSync(':memory:');

    const actual = () =>
      migrate(
        db,
        [
          { version: schemaVersion(1, 1), apply: () => {} },
          { version: schemaVersion(1, 0), apply: () => {} },
        ],
        'test',
        noopLogger,
      );
    expect(actual).toThrow();
  });
});
