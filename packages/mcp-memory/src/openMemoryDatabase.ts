import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDataDir } from './getDataDir.js';

/** Opens (creating if needed) this package's own `memory.db` under the XDG data directory for `shellicar-mcp-memory`. `dataDir` overrides the resolved directory; tests pass a scratch one instead. */
export function openMemoryDatabase(dbFileName = 'memory.db', dataDir = getDataDir('shellicar-mcp-memory')): DatabaseSync {
  const path = join(dataDir, dbFileName);
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA journal_mode = WAL');
  return db;
}
