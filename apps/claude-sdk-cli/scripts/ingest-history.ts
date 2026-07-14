import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NodeFileSystem } from '@shellicar/claude-sdk-tools/fs';
import { SqliteHistoryEngine } from '../src/persistence/SqliteHistoryEngine.js';
import { ingestHistory } from './ingestHistory.js';

// Standalone: rebuilds ~/.claude/history.db from the audit files. Opens the db directly (outside DI), and the engine
// brings the schema up on construction; the ingest is idempotent, so a repeat run is safe. Never run while a CLI is
// writing — the guarantee the write model relies on.
const fs = new NodeFileSystem();
const path = `${fs.homedir()}/.claude/history.db`;
// node:sqlite cannot open a database in a directory that does not exist.
mkdirSync(dirname(path), { recursive: true });
const engine = new SqliteHistoryEngine(new DatabaseSync(path));

const summary = await ingestHistory(fs, engine, (line) => process.stdout.write(`${line}\n`));
process.stdout.write(`${JSON.stringify(summary)}\n`);
