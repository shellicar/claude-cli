'use strict';

// Minimal SEA proof-of-concept exercising both halves of the runtime/execution split.
//
// A — node:sqlite runs inside the bundled (Node 24) runtime.
// B — a spawned `node` resolves from PATH, so it reports the shell's Node version,
//     not the runtime bundled into this binary.
//
// Built as a Single Executable Application; see build.sh for the recipe.

const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

function proveSqlite() {
  // A real on-disk database, the shape the CLI's store actually uses.
  const dbPath = path.join(os.tmpdir(), `sea-poc-${process.pid}.db`);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('hello', 'world');
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('hello');
    return row.value;
  } finally {
    db.close();
    fs.rmSync(dbPath, { force: true });
  }
}

function proveSpawnedNode() {
  // `node` is resolved from PATH at exec time. In a SEA, the bundled runtime
  // lives inside this executable, not on PATH as `node`, so this is the shell's node.
  return execFileSync('node', ['-v'], { encoding: 'utf8' }).trim();
}

const bundledRuntime = process.version;
const sqliteValue = proveSqlite();
const spawnedNode = proveSpawnedNode();

console.log('=== SEA runtime/execution split POC ===');
console.log(`A  node:sqlite read-back ...... ${sqliteValue} (expected: world)`);
console.log(`   bundled runtime (this app) .. ${bundledRuntime}`);
console.log(`B  spawned \`node -v\` .......... ${spawnedNode}`);
console.log('');

const aPass = sqliteValue === 'world';
const bSplit = spawnedNode !== bundledRuntime;
console.log(`A node:sqlite works inside SEA ....... ${aPass ? 'PASS' : 'FAIL'}`);
console.log(`B spawned node != bundled runtime .... ${bSplit ? 'PASS' : 'FAIL'} (${spawnedNode} vs ${bundledRuntime})`);

process.exit(aPass && bSplit ? 0 : 1);
