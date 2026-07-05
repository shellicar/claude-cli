import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseFactory } from '../src/persistence/DatabaseFactory.js';
import { IDatabaseOptions } from '../src/persistence/IDatabaseOptions.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

// DatabaseFactory opens on-disk files at `${homedir()}/.claude/${name}`, so a MemoryFileSystem whose homedir is a
// real temp dir routes every open under a scratch directory that afterAll cleans up.
let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'database-factory-'));
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

// A fresh factory each call: getDatabase memoises one connection per name, so a new factory is how a test opens a
// second, independent connection to the same file — standing in for a second CLI opening the shared store.
function buildFactory(): DatabaseFactory {
  const services = createServiceCollection();
  const fs = new MemoryFileSystem({}, home, home);
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(IDatabaseOptions).to(IDatabaseOptions, () => ({ inMemory: false }) satisfies IDatabaseOptions);
  services.register(DatabaseFactory).to(DatabaseFactory);
  return services.buildProvider().resolve(DatabaseFactory);
}

describe('DatabaseFactory — open-path resilience', () => {
  // NOTE (Scaffolder): this guards the open path against throwing when a connection is already held, but it does
  // NOT reproduce the production startup-herd regression the fix targets. That regression is a genuinely
  // concurrent (multi-process) race on the initial WAL switch; in a single-process test the WAL re-assert on an
  // already-WAL file does not throw even under a held write lock, so this passes against today's code too. A
  // deterministic red for the herd could not be produced in-process — see the Scaffolder debrief. Kept as a
  // regression guard on the resilience the Builder's fix must preserve.
  it('does not throw opening a WAL file in quick succession while another connection holds the write lock', () => {
    // First open creates the file and sets WAL with no contention; WAL is persistent, so later opens find it already WAL.
    buildFactory().getDatabase('herd.db');
    const dbPath = join(home, '.claude', 'herd.db');

    // A concurrent writer holds the write lock, standing in for another CLI mid-write during the startup herd.
    const writer = new DatabaseSync(dbPath);
    writer.exec('PRAGMA busy_timeout = 5000');
    writer.exec('CREATE TABLE IF NOT EXISTS lock_holder (x INTEGER)');
    writer.exec('BEGIN IMMEDIATE');
    writer.exec('INSERT INTO lock_holder (x) VALUES (1)');

    const actual = () => {
      for (let i = 0; i < 20; i++) {
        buildFactory().getDatabase('herd.db');
      }
    };
    expect(actual).not.toThrow();

    writer.exec('COMMIT');
  });

  it('sets journal_mode to wal on a freshly created database file', () => {
    const db = buildFactory().getDatabase('fresh.db');

    const expected = 'wal';
    const actual = (db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode;
    expect(actual).toBe(expected);
  });

  it('applies busy_timeout to an opened connection', () => {
    const db = buildFactory().getDatabase('timeout.db');

    const expected = 5000;
    const actual = (db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout;
    expect(actual).toBe(expected);
  });
});
