import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { type Migration, migrate, schemaVersion } from '../src/persistence/migrate.js';
import { RecordingLogger } from './RecordingLogger.js';

const userVersion = (db: DatabaseSync): number => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

describe('migrate — stamping', () => {
  it('stamps user_version to the latest applied migration', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, [{ version: schemaVersion(1, 0), apply: () => {} }], new RecordingLogger(), 'test');

    const expected = schemaVersion(1, 0);
    const actual = userVersion(db);
    expect(actual).toBe(expected);
  });
});

describe('migrate — applying', () => {
  it('runs a pending migration', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, [{ version: schemaVersion(1, 0), apply: (d) => d.exec('CREATE TABLE marker (n INTEGER)') }], new RecordingLogger(), 'test');

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
    migrate(db, migrations, new RecordingLogger(), 'test');
    migrate(db, migrations, new RecordingLogger(), 'test');

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
      new RecordingLogger(),
      'test',
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
        new RecordingLogger(),
        'test',
      );
    expect(actual).not.toThrow();
  });

  it('does not down-migrate a newer-minor store', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${schemaVersion(1, 5)}`);
    migrate(db, [{ version: schemaVersion(1, 0), apply: () => {} }], new RecordingLogger(), 'test');

    const expected = schemaVersion(1, 5);
    const actual = userVersion(db);
    expect(actual).toBe(expected);
  });

  it('refuses a store at a newer major', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${schemaVersion(2, 0)}`);

    const actual = () => migrate(db, [{ version: schemaVersion(1, 0), apply: () => {} }], new RecordingLogger(), 'test');
    expect(actual).toThrow();
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
        new RecordingLogger(),
        'test',
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
        new RecordingLogger(),
        'test',
      );
    expect(actual).toThrow();
  });
});

describe('migrate — logging', () => {
  it('logs the user_version when the schema is already up to date', () => {
    const db = new DatabaseSync(':memory:');
    const logger = new RecordingLogger();
    migrate(db, [{ version: schemaVersion(1, 0), apply: () => {} }], logger, 'test');
    logger.entries.length = 0; // discard the first migrate's logs
    migrate(db, [{ version: schemaVersion(1, 0), apply: () => {} }], logger, 'test');

    const expected = schemaVersion(1, 0);
    const entry = logger.entries.find((e) => e.message.includes('up to date'));
    const actual = (entry?.meta[0] as { userVersion: number }).userVersion;
    expect(actual).toBe(expected);
  });

  it('logs an error when refusing a store at a newer major', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${schemaVersion(2, 0)}`);
    const logger = new RecordingLogger();
    try {
      migrate(db, [{ version: schemaVersion(1, 0), apply: () => {} }], logger, 'test');
    } catch {}

    const expected = 'error';
    const actual = logger.entries.find((e) => e.message.includes('newer than this build'))?.level;
    expect(actual).toBe(expected);
  });
});
