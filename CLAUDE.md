# @shellicar/claude-cli

## Convention

This repository uses `shellicar-oss` conventions.

## Milestone

All work is tracking toward the `1.0.0` milestone.

## Why This SDK Exists

The official Anthropic SDK is a black box: you get a response, but the agent loop is opaque. `@shellicar/claude-sdk` makes the loop transparent, and that transparency is what enables everything else.

| Pillar | What it needs from the SDK |
|--------|---------------------------|
| **The Case** (context management) | Own the messages array; expose push/remove; control what enters context |
| **The Cage** (cost visibility) | Stream per-turn usage data so the consumer can track costs as they happen |
| **The Mailroom** (orchestration) | Bidirectional MessageChannel protocol; every agent looks the same to an orchestrator |
| **The Tower** (observability) | Emit events (tools, approvals, costs, errors); consumer slots in as approver via held-promise |
| **The Pit** (sandbox) | Consumer-controlled tool pipeline: validate → approve → execute |

If a design decision serves none of the pillars, it probably doesn't belong in the SDK.

Full detail: `.claude/five-banana-pillars.md`

## Architecture

**Stack**: TypeScript, tsup (bundler), `@anthropic-ai/sdk` (direct). pnpm monorepo with turbo.

### Packages

| Package | Role |
|---------|------|
| `apps/claude-sdk-cli/` | **Active TUI CLI** — talks directly to `@shellicar/claude-sdk` |
| `apps/claude-cli/` | Legacy CLI, not actively developed. Excluded from maintenance releases and dep updates. Not bumped unless a shared published package requires explicit version alignment. |
| `packages/claude-sdk/` | SDK wrapper: agent session, tool registry, query runner, stream processor |
| `packages/claude-sdk-tools/` | Tool definitions: Find, ReadFile, Grep, Head, Tail, Range, SearchFiles, Pipe, EditFile, PreviewEdit, CreateFile, DeleteFile, DeleteDirectory, Exec, Ref, TsDiagnostics, TsHover, TsDefinition, TsReferences |
| `packages/claude-core/` | Shared: IFileSystem, expandPath, ANSI/terminal utilities |
| `packages/mcp-exec/` | MCP server wrapping Exec tool. Bundles its first-party `@shellicar` deps into the output; third-party (`@modelcontextprotocol/sdk`) stays external |
| `packages/mcp-internals/` | Private, never-published source-of-truth for MCP helpers (e.g. `getDataDir`), designed to be inlined by any MCP server that uses it rather than shipped as a runtime dependency. `private: true` |
| `packages/exec-core/` | Process-spawning core: stream-based single-process spawn behind a shared interface |
| `platforms/claude-sdk-cli-darwin-arm64/` | Published prebuilt SEA binary (macOS arm64) for the CLI, selected via the CLI's optional dependency. Bumped in lockstep whenever `claude-sdk-cli` is released. |

### Bundling: bundled and published are separate axes

Whether a package is bundled and whether it is published are two independent decisions. That a package is inlined into another's output says nothing about whether it ships to npm.

`mcp-exec` shows the bundled side: it inlines its first-party `@shellicar` dependencies into its own output and leaves third-party ones external (`@modelcontextprotocol/sdk`, which the consumer brings). `@shellicar/claude-sdk-tools` is one such bundled dependency, and it is also published and depended on directly by other packages: bundled here, yet public and shared.

`@shellicar/mcp-internals` sits at the other end of the published axis. It is `private: true` and never published: a source-of-truth for MCP helpers meant to be inlined by any MCP server that uses it, so that server's consumers carry no dependency on it. Being bundled into a server is how it is meant to be consumed; being unpublished is a separate, independent fact.

So bundling is a build-time inlining choice, published is a distribution choice, and one does not imply the other. A first-party package is bundled to keep the consumer's dependency surface small; whether it is also published depends only on whether it is a shared, public API.

### Tool System

Tool handlers return `{ textContent: TOutput; attachments?: ToolAttachmentBlock[] }`. The ToolRegistry destructures `textContent` (sends through transform) and `attachments` (puts in `tool_result.content` as native API content blocks). Each tool defines its output via `output_schema` on `ToolDefinition`.

ReadFile supports binary files (PDF, images) via `mimeType` parameter. Binary content is delivered to the API as native document/image blocks inside the tool result.

### TUI Architecture (MVC + MVVM)

Four roles: Model/State (pure data, owned by whoever updates it), ViewModel/Renderer (pure functions: `(state, cols) → string[]`), View/Display (screen output, reads state), Controller/Input (key routing, writes state).

`main.ts` is the DI container. `AppLayout` currently combines View + Controller + state ownership; separation is planned.

## Conventions

- **TypeScript** throughout
- **Zod** for config validation and tool schemas
- **Dependency injection** via `@shellicar/core-di-lite` (`@dependsOn`), wired in `main.ts`. **Every injectable class has an abstract class, named with an `I` prefix** (`IFoo` for the concrete `Foo`): register the abstract to the concrete (`register(IFoo).to(Foo)`) and depend on the abstract (`@dependsOn(IFoo)`). Registering or depending on a bare concrete is concrete injection (CI), not DI. A manual construction factory is a smell — declare the class's dependencies with `@dependsOn` instead.
- **No TUI framework** — raw ANSI escape sequences on `process.stdout`
- **JSONL** for audit log
- Build output: `dist/esm/` and `dist/cjs/` via tsup (ESM + CJS + DTS)

## Pull Requests

Every PR must include:

- **Milestone**: `1.0`
- **Reviewer**: `bananabot9000`
- **Assignee**: `shellicar`
- **Label(s)**: match the nature of the work — `bug` (something isn't working), `enhancement` (new feature), `documentation`, `dependencies` (dependency updates), `security` (security fixes). Apply more than one where relevant; a CVE/dependency PR is `dependencies` + `security`, not `bug`. `bug` is for actual broken behaviour, not any change framed as a fix.
- **Package label(s)**: add a `pkg: <name>` label for every package the PR touches

## Releases & Changelog

Per-package releases. Tag format: `<package-name>@<version>` (e.g. `claude-sdk@1.0.0-beta.1`). Legacy `claude-cli` uses unscoped tags.

Each package has `changes.jsonl` and `CHANGELOG.md`. An entry belongs in a package's `changes.jsonl` only when a change touches that package, and only when the change reaches a consumer of it — internal refactors, test-only or build-plumbing changes don't qualify:

```jsonl
{"description":"What changed","category":"added|changed|deprecated|removed|fixed|security"}
```

`CHANGELOG.md` is generated from `changes.jsonl`. **Whenever you edit a `changes.jsonl`, regenerate the changelogs in the same change** — the two must never drift. Regenerate every package in one shot:

```bash
pnpm --filter scripts run changelog
```

That runs the generator over every package with a `changes.jsonl`. To regenerate a single package, run `tsx src/generate-changelog.ts ../<package-dir>` from the `scripts/` directory. CI fails if any `CHANGELOG.md` is out of sync with its `changes.jsonl`, so regenerate before pushing.

### @shellicar/changes tooling

`changes.config.json` defines valid categories. `schema/shellicar-changes.json` is generated from it. Validate by running `tsx src/validate-changes.ts` from the `scripts/` directory. CI runs this automatically.

### Lockstep versioning

All packages share the same version number. If a package has source changes since the last release, it gets bumped to the new version. Packages without changes are not bumped. A package whose published dependency is bumping is also bumped, even without source changes of its own — republishing re-pins it to the new dependency version so consumers resolving that package get the new dependency.

**Platform packages bump with the CLI.** The prebuilt per-platform binaries under `platforms/*` (e.g. `@shellicar/claude-sdk-cli-darwin-arm64`) are published packages selected through the CLI's optional dependencies. When enumerating release targets, walk `platforms/*` alongside `apps/*` and `packages/*` — not just the latter two. The rule: *if `claude-sdk-cli` is released or bumped, every platform package is bumped to the same version in the same release.* The CI publish path enforces this — `ci.yml` runs the `publish-package` action, whose "Verify version matches tag" step fails on a version mismatch between a platform package's manifest and the release tag.

### Pre-release process (current)

All releases are pre-releases until 1.0.0. The current version series is `1.0.0-beta.N`.

**No release markers in changes.jsonl for pre-releases.** All entries stay under `[Unreleased]` in the changelog. When 1.0.0 ships, the changelog will show the complete diff from zero to 1.0.0. Individual beta changelogs are noise for anyone consuming the library.

**Steps:**

1. Determine which packages have source changes since the last release tag:
   ```bash
   git diff --stat <last-tag> HEAD -- <package>/src/
   ```
   Run this for each package directory. Cross-reference with new entries in each package's `changes.jsonl` (diff against the tag). Only packages with source changes get bumped.

2. Bump version in each changed package:
   ```bash
   cd <package-dir>
   pnpm version 1.0.0-beta.N --no-git-tag-version
   ```

3. Generate changelogs for each bumped package (run from `scripts/`):
   ```bash
   pnpm exec tsx src/generate-changelog.ts ../<package-dir>
   ```
   The script puts all entries under `[Unreleased]` (no release markers exist). If it produces changes for a package that was not bumped, stop and investigate.

4. Verify: `pnpm turbo run build type-check test`

5. Single PR with all version bumps, changelog updates, and lock file changes.

6. After merge, create a GitHub release for each bumped package:
   ```bash
   gh release create "<package>@<version>" --title "<package>@<version>" --target <main-sha> --notes "<unreleased section>" --prerelease
   ```
   Each release triggers the npm-publish workflow. Wait for each workflow to complete before creating the next.

### Stable releases (future)

Stable releases (e.g. 1.0.0, 1.1.0) use release markers in changes.jsonl. The changelog script moves entries from `[Unreleased]` into a dated version section. Pre-releases between stable versions (e.g. 1.1.0-beta.1) follow the pre-release process above: no release markers, everything stays under `[Unreleased]` until the next stable release.

### Build versioning

`@shellicar/build-version` is an esbuild plugin that runs GitVersion at build time and injects version metadata into the bundle. The chain is:

1. Each package's `tsup.config.ts` imports `@shellicar/build-version/esbuild`
2. The plugin is configured with `versionCalculator: 'gitversion'`
3. At build time, the plugin runs `gitversion` and injects the result
4. Application code imports `@shellicar/build-version/version` to read the injected values (version, branch, sha, commitDate, buildDate)

GitVersion is configured in `GitVersion.yml` at the repo root. There are no other direct references to GitVersion in the codebase. The `@shellicar/build-version` dependency is the only consumer.


## Linting & Formatting

- **Formatter/linter**: `biome`
- **Git hooks**: `lefthook`
- **Fix command**: `pnpm ci:fix` — never use `pnpm biome check --write` directly
- **Type check**: `pnpm type-check`
- **Build**: `pnpm build`

## Toolchain: TC39 decorators pin us to Vite 7

This codebase uses **TC39 standard decorators** (e.g. `@dependsOn` from `@shellicar/core-di-lite` for dependency injection), with `experimentalDecorators` **off**. This is the ECMAScript-standard decorator, deliberately not legacy TypeScript decorators.

**Vitest must run on Vite 7.** Vite 7 transforms with esbuild, which lowers standard decorators. **Vite 8 replaced esbuild with Rolldown/oxc, and oxc does not transform stage-3 decorators** — on Vite 8 every decorated spec fails to load with `SyntaxError: Invalid or unexpected token`. The package build (tsup → esbuild, `target: node24`) lowers decorators independently, so this is specifically a constraint on the vitest transform, not the build.

Do **not** let the lockfile resolve `vite@8` for vitest. `vitest` peer-allows `^6 || ^7 || ^8`, so a careless `pnpm update` can pull in v8 and break the whole suite. Keep vite on `^7`.

Why oxc can't do it: the TC39 decorators proposal was demoted from Stage 3 to **Stage 2.7** (May 2026) — the spec is still in flux with incomplete test262 coverage — so oxc is deliberately holding off on the transform until it stabilises. esbuild (Vite 7) kept its existing stage-3 lowering; oxc (Vite 8) never added it.

- oxc-project/oxc#9170 — "transformer: ecma decorators" (canonical tracker): <https://github.com/oxc-project/oxc/issues/9170>
- rolldown/rolldown#7327 — "[Feature]: ecma decorators support": <https://github.com/rolldown/rolldown/issues/7327>
- Vite 8 migration note + Babel/SWC workaround: <https://vite.dev/guide/migration#javascript-transforms-by-oxc>

## Branch Naming

- `feature/` — new functionality
- `fix/` — bug fixes
- `docs/` — documentation-only changes
- `security/` — security fixes

## Key Patterns

### Tool Handler Contract

Every tool handler returns `{ textContent: TOutput; attachments?: ToolAttachmentBlock[] }`. The `textContent` goes through the transform (ref-swapper for large outputs). Attachments bypass the transform and are placed directly in `tool_result.content` as API content blocks.

### Keypress-Driven Event Loop

`handleKey()` dispatches in priority order: CommandMode → PermissionManager → PromptManager → Editor. No polling.

### Config Hot Reload

File watcher on both config paths (home + local). 100ms debounce. Only reloads during `idle` phase. After reload: `diffConfig()` detects changes.

### System Prompt

`SystemPromptBuilder` collects `SystemPromptProvider` instances. Providers run in parallel via `Promise.all`. Two built-in: `GitProvider` (branch/sha/status) and `UsageProvider` (time/context/cost).

### Cache markers

A request carries cache breakpoints so a stable prefix is served from cache instead of re-billed each turn. Anthropic allows at most 4 per request. Three are always set: the system prompt, the tools, and a moving marker on the last user message that advances each turn so only the new message is a cache write. The fourth is added only when CLAUDE.md is present: a stable-prefix marker pinned to the end of the assembled CLAUDE.md content, held at the same position every turn so that content is a cache read after the first turn.

With CLAUDE.md present the request spends all 4 breakpoints. There is no headroom left, so any future change that needs a fifth breakpoint will be rejected by the API.

## Test Infrastructure

**Framework**: vitest. Each package has its own `vitest.config.ts` and `test/` directory.

**Abstractions over mocks.** Use `MemoryFileSystem` (implements `IFileSystem`) instead of mocking filesystem calls. Use injectable callables instead of `vi.mock`. If something touches the outside world, it should have an interface and a fake. Mocks are the escape hatch, not the default.

**Helper locations:**
- `apps/claude-sdk-cli/test/MemoryFileSystem.ts`: in-memory `IFileSystem` for CLI tests
- `packages/claude-sdk-tools/test/MemoryFileSystem.ts`: in-memory `IFileSystem` for tool tests
- `packages/claude-sdk-tools/test/helpers.ts`: `call()` and `callFull()` wrappers that parse input and invoke a tool handler

**Test style** (load the `tdd` skill for full conventions):
- One assertion per `it` block
- `expected`/`actual` variables, not inline values in `expect()`
- Describe blocks group by method or behaviour, not by test type
- Test names describe what is tested, not how

## Database Schema & Migrations

The CLI bundles its own SQLite schema authority. There is no server and no API tier: every `claude-sdk-cli` process opens the shared store files under `~/.claude` directly, so each running build is a co-equal authority on what the schema means. Two builds can run at once on the same machine (an updated one and an old one not yet replaced). That fact governs how schema changes must be made.

**Versioning.** Each SQLite store stamps its schema version in `PRAGMA user_version`, encoded as `major * 1000 + minor`. On open, a store runs an ordered, append-only migration list up to the build's current version, each migration in its own transaction. A store whose **major** exceeds the build's supported major is refused, never down-migrated (a newer build wrote it). A newer **minor** within the same major is tolerated and operated against, not migrated.

**The rule that keeps a mixed-version machine safe. Do not break it:**

- **Minor bump = additive only (expand).** New tables or columns, backfills. An older concurrently-running build must keep working against the new shape. Safe to ship at any time.
- **Major bump = destructive (contract).** Removing or repurposing a table or column. This deliberately makes every older build *refuse* the store. Only bump major when you accept that old CLIs stop working until updated.
- **Never make a destructive change as a minor.** If a change removes or repurposes anything an older build reads or writes, it is a major bump, full stop. Shipping it as a minor corrupts or breaks any old CLI sharing the file.
- **Migrations are immutable once shipped.** Never edit a released migration; append a new one. The list is the history every old store replays to catch up.

**Why no API tier, and the escape hatch.** A server owning the database behind a stable API is the textbook fix (ship an API that speaks both schemas, migrate, clients stay dumb). It does not port to embedded SQLite, where the file *is* the server and every opener is an authority. The seam that preserves the option is the `IMemoryStore` / `IObjectStore` interface: if a store ever needs true central authority, swap its implementation for a client to a local daemon with no change above the interface. Until then, expand/contract discipline is the only thing keeping mixed versions safe, and it is a human discipline, which is why it is written here rather than left to be rediscovered.

## Known Debt

1. **AuditWriter is fatal-on-error** — any write failure calls `process.exit(1)`
2. **thinking/thinkingEffort not tracked by diffConfig** — changes produce no user notification
3. **Slash commands are string-matched** — no command registry
4. **Context thresholds hardcoded** — 85%/90% tool disable thresholds not configurable
5. **No atomic session file writes** — `writeFileSync` is not atomic
6. **AppLayout combines View + Controller** — separation planned
