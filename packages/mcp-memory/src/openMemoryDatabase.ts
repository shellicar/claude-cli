import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDataDir } from '@shellicar/mcp-internals';

/** Opens (creating if needed) the SQLite file backing the memory store, under the mcp-internals data directory for this package. */
export function openMemoryDatabase(dbFileName = 'memory.db'): DatabaseSync {
  const dir = getDataDir('shellicar-mcp-memory');
  mkdirSync(dir, { recursive: true });
  return new DatabaseSync(join(dir, dbFileName));
}
