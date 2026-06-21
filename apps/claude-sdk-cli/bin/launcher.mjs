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
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

const pkg = `@shellicar/claude-sdk-cli-${process.platform}-${process.arch}`;

let binary;
try {
  binary = require.resolve(`${pkg}/claude-sdk-cli`);
} catch (err) {
  console.error(`Error [${err.code}]: ${err.message}`);
  process.exit(1);
}

// typescript can't live inside the SEA blob: the TypeScript server resolves it
// through a dynamic require and runs tsserver.js as a separate node process that
// reads files off disk, so it ships as an on-disk dependency of this launcher.
// The launcher runs on the user's Node with a real path, so it can resolve
// typescript here and hand the binary the tsserver.js path through the env;
// inside the SEA, import.meta.url is virtual and can't resolve it. The env var
// name is the contract with TsServerService (TSSERVER_PATH_ENV). If typescript
// is absent the var stays unset and the CLI boots with the TS tools degraded.
const env = { ...process.env };
try {
  const tsMain = require.resolve('typescript');
  const tsserverPath = join(dirname(tsMain), 'tsserver.js');
  if (existsSync(tsserverPath)) {
    env.CLAUDE_SDK_CLI_TSSERVER_PATH = tsserverPath;
  }
} catch {
  // typescript not resolvable beside the launcher: leave the env var unset.
}

// Run the SEA binary as a foreground child and tie this launcher's lifecycle to
// it. The child shares our stdio and stays in our process group, so it can read
// the terminal in raw mode (the TUI needs that). Signal handling is the
// load-bearing part, because there are two delivery paths:
//
//   - The terminal sends SIGINT/SIGQUIT (Ctrl-C, Ctrl-backslash) to the whole
//     foreground group, so the child already gets them directly. We must not
//     re-forward (the child would see them twice; for SIGINT that trips its
//     'second press = force quit'), and we must not let them kill this launcher
//     before the child has run its own cleanup. So we swallow them here and let
//     the child exit on its own.
//   - A signal sent straight to this launcher's PID (e.g. an orchestrator that
//     spawned the CLI and later kills it) never reaches the child through the
//     group, which would orphan the SEA. So we relay SIGTERM/SIGHUP to the
//     child. The terminal never sends SIGTERM to the group, so relaying it can't
//     double-deliver.
//
// spawnSync can't do any of this: it blocks the event loop, so the launcher's
// signal handlers could not run until the child had already exited. Hence the
// async spawn.
function runForeground(command, args, options) {
  const child = spawn(command, args, options);

  const relayed = ['SIGTERM', 'SIGHUP'];
  const swallowed = ['SIGINT', 'SIGQUIT'];
  const listeners = [];

  for (const signal of relayed) {
    const onSignal = () => {
      try {
        child.kill(signal);
      } catch {
        // Child exited between the signal arriving and this kill; nothing to do.
      }
    };
    listeners.push([signal, onSignal]);
    process.on(signal, onSignal);
  }
  for (const signal of swallowed) {
    const onSignal = () => {};
    listeners.push([signal, onSignal]);
    process.on(signal, onSignal);
  }

  child.on('error', (err) => {
    console.error(`claude-sdk-cli: failed to start binary: ${err.message}`);
    process.exit(2);
  });

  child.on('exit', (code, signal) => {
    for (const [name, onSignal] of listeners) {
      process.removeListener(name, onSignal);
    }
    if (signal) {
      // The child died from a signal. Re-raise it on ourselves (default action
      // is restored now the listener is gone) so our parent sees the same
      // termination cause instead of a plain exit code.
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

runForeground(binary, process.argv.slice(2), { stdio: 'inherit', env });
