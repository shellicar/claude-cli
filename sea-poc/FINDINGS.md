# SEA runtime/execution split — POC findings

**Date:** 2026-06-21
**Machine:** macOS arm64
**Question:** Does a Single Executable Application (SEA) run its own bundled Node
(24, for `node:sqlite`) while a `node` it spawns still resolves to the shell's
Node version? This is the go/no-go for rolling claude-sdk-cli's SQLite store
forward as a SEA instead of removing it.

## Answer: yes — the split holds

Both halves proved in a single run of the binary, launched from a shell where
`node -v` is v20.

### Evidence (verbatim output)

Built with Node 24, run from an fnm Node 20 shell:

```
shell node: v20.20.2

=== SEA runtime/execution split POC ===
A  node:sqlite read-back ...... world (expected: world)
   bundled runtime (this app) .. v24.17.0
B  spawned `node -v` .......... v20.20.2

A node:sqlite works inside SEA ....... PASS
B spawned node != bundled runtime .... PASS (v20.20.2 vs v24.17.0)
exit: 0
```

- **A — `node:sqlite` inside the SEA.** The app opened an on-disk `node:sqlite`
  database, created a table, inserted a row, and read it back (`world`). The
  bundled runtime reported itself as **v24.17.0**. So `node:sqlite` is available
  and works inside the bundled binary, with no native addon to load.
- **B — spawned `node` is the shell's version.** The app spawned `node -v` via
  `child_process` (resolved from `PATH`) and it reported **v20.20.2** — the
  shell's fnm version, not the bundled 24. The bundled runtime lives inside the
  executable, not on `PATH` as `node`, so the tie between parent runtime and
  spawned `node` is broken exactly as the approach needs.

## What this means for the mission

The one unproven assumption the whole SQLite-portability direction rests on is
confirmed: a SEA-bundled CLI can run on its own Node 24 (`node:sqlite`, no
native addon, no `NODE_MODULE_VERSION` lock) while the `node` it execs runs at
the project's pinned version. Rolling the store forward is viable.

## Working build recipe (inherit this; don't re-derive)

The exact, working flow is in `build.sh`. Summary for macOS arm64:

1. **Generate the blob** with Node 24:
   `node --experimental-sea-config sea-config.json` → writes `sea-prep.blob`.
2. **Copy the Node 24 binary** to become the app: `cp "$(node24 execPath)" sea-poc-app`.
3. **Strip the signature** (macOS requires this before modifying the Mach-O):
   `codesign --remove-signature sea-poc-app`.
4. **Inject the blob** with postject, using the documented sentinel fuse and
   Mach-O segment name:
   `npx postject sea-poc-app NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA`.
5. **Ad-hoc re-sign** so macOS will run the modified binary:
   `codesign --sign - sea-poc-app`.

Run: `./sea-poc-app` from any shell. Files: `app.cjs` (the app, CommonJS — SEA
requires CJS), `sea-config.json` (SEA config), `build.sh` (the recipe).

### Environment notes worth not re-deriving

- **`node:sqlite` needs no flag on Node 24.17** — `require('node:sqlite')` and
  `DatabaseSync` work unflagged. (On Node 22.x it is still behind
  `--experimental-sqlite`.) This matters: a SEA cannot easily pass `node` CLI
  flags to its own runtime, so an unflagged API is what makes the bundled-24
  path clean.
- **postject** is not installed locally; `npx -y postject` fetches it on demand
  (network required at build time).
- **macOS signing is mandatory, not optional.** Injecting the blob invalidates
  the binary's signature; without the strip-then-ad-hoc-re-sign bracket the
  modified binary is killed by the OS on launch. The strip→inject→sign order is
  load-bearing.
- The brief named Node 20 as the shell version; fnm has v20.20.2 installed, so
  the proof matches the brief literally. The substance is only that the spawned
  version differs from the bundled 24 — any non-24 shell Node proves the split.
