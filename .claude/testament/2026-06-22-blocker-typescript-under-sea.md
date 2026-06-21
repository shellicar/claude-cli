# BLOCKER — TypeScript tooling fails under the SEA

**Status:** open. Found 2026-06-22 by running the locally-built SEA binary directly.
**Severity:** release blocker. Phase 4 must not cut the beta until this is resolved —
the binary crashes on launch, so the acceptance bar ("installs and *works*") is not met.
**Owner:** next Maker, with the SC. This is an implementation-design fix, out of the
Courier's scope; recorded here, not patched.

## Symptom

Running the built binary with no args (a normal launch, not `--version`):

```
Error: Cannot find module 'typescript'
Require stack:
- .../platforms/claude-sdk-cli-darwin-arm64/claude-sdk-cli
    at require.resolve (node:internal/modules/helpers)
    at resolveTsServerPath (.../claude-sdk-cli:179)
    at vo.start (.../claude-sdk-cli:179)
    at main (.../claude-sdk-cli:293)
  code: 'MODULE_NOT_FOUND'
```

## Mechanism

- `apps/claude-sdk-cli/src/entry/main.ts:225` starts the TypeScript server **eagerly at
  launch**: `await provider.resolve(TsServerService).start();`. So this is fatal on
  startup, not deferred to first TS-tool use.
- `TsServerService.start()` → `resolveTsServerPath()`
  (`packages/claude-sdk-tools/src/typescript/TsServerService.ts:41-45`) calls
  `createRequire(import.meta.url).resolve('typescript')`. Inside the SEA, `import.meta.url`
  is the **virtual binary path**; there is no `node_modules/typescript` beside it, so the
  resolve throws `MODULE_NOT_FOUND`.

## Why the SEA model can't absorb `typescript`

`typescript` is the one dependency the self-contained-bundle approach cannot embed, for
two independent reasons — either is fatal on its own:

1. It is pulled in by a **dynamic `require.resolve`**, which esbuild cannot bundle into
   the blob.
2. Even once resolved, `tsserver.js` is **spawned as a separate `node` process** that
   reads files off disk (`spawn('node', [tsserverPath, ...])`, `TsServerService.ts:75`).
   So `typescript` must physically exist on disk; it cannot be in-process inside the blob.

The "ESM SEA resolves only builtins, everything else is bundled" assumption holds for
statically-imported, in-process deps. `typescript` is neither static nor in-process, so it
falls through the gap.

## Why earlier verification missed it

Phase 2 verified with `node bin/launcher.mjs --version` → exit 0. `--version`
short-circuits before `main.ts:225`, so the eager `start()` never ran. Only "prints a
version" was ever exercised — never a real launch. `typescript` being a production
dependency (added in #266 for exactly this resolution to work in installed environments)
was correct for an npm package with `node_modules`, but the SEA ships no `node_modules`.

## What a fix has to address (root)

`typescript` must exist **on disk beside the install**, and resolution must target the
**launcher's real on-disk location**, not the SEA's virtual `import.meta.url`. The
launcher (`apps/claude-sdk-cli/bin/launcher.mjs`) runs on the user's Node and knows its own
real path, so it is the natural place to locate `typescript`/`tsserver.js`.

## Option space (for the SC + Maker — not yet decided)

- **Declare `typescript` a real dependency of the launcher (or platform) package**, so npm
  installs it to disk, and resolve `tsserver.js` relative to the launcher rather than the
  SEA binary.
- **Have the launcher locate `tsserver.js` and pass the path into the SEA** (env var or
  arg); `resolveTsServerPath` reads that instead of `require.resolve` from the SEA's url.

Both share the same root: `typescript` lives on disk, and the resolver looks at the
launcher's location. Which mechanism is the Maker's call with the SC.

## Secondary observation

The eager `start()` at `main.ts:225` makes *any* tsserver-unavailability fatal at launch.
Whether `start()` should be lazy or tolerant is worth a look, but it is secondary — the
resolution fix is the blocker.
