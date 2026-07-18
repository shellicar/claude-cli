import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Opens (creating if needed) the same `memory.db` the CLI itself reads and writes, under `~/.claude`, so a memory written through either one is visible to the other. `home` defaults to the real home directory; tests pass a scratch one instead. */
export function openMemoryDatabase(dbFileName = 'memory.db', home = homedir()): DatabaseSync {
  const path = join(home, '.claude', dbFileName);
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA journal_mode = WAL');
  return db;
}
