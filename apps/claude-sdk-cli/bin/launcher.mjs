#!/usr/bin/env node
// Launcher for @shellicar/claude-sdk-cli.
//
// The CLI ships as a Single Executable Application: a platform-specific binary
// that bundles its own Node runtime (so the node:sqlite store runs regardless
// of the Node version the user's shell resolves). Each platform's binary lives
// in its own optional dependency (@shellicar/claude-sdk-cli-<platform>-<arch>),
// gated by os/cpu so npm installs only the one matching the host. This launcher
// resolves that binary and hands the process over to it.
//
// The launcher itself runs on the user's Node — it touches no node:sqlite, so it
// is safe on any Node version. Only the resolved SEA binary needs the bundled 26.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const pkg = `@shellicar/claude-sdk-cli-${process.platform}-${process.arch}`;

let binary;
try {
  binary = require.resolve(`${pkg}/claude-sdk-cli`);
} catch (err) {
  console.error(`Error [${err.code}]: ${err.message}`);
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' });

if (result.error) {
  console.error(`claude-sdk-cli: failed to start binary: ${result.error.message}`);
  process.exit(2);
}

process.exit(result.status ?? 3);
