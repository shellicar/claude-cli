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
| `apps/claude-cli/` | Legacy CLI (not actively developed) |
| `packages/claude-sdk/` | SDK wrapper: agent session, tool registry, query runner, stream processor |
| `packages/claude-sdk-tools/` | Tool definitions: Find, ReadFile, Grep, Head, Tail, Range, SearchFiles, Pipe, EditFile, PreviewEdit, CreateFile, DeleteFile, DeleteDirectory, Exec, Ref, TsDiagnostics, TsHover, TsDefinition, TsReferences |
| `packages/claude-core/` | Shared: IFileSystem, expandPath, ANSI/terminal utilities |
| `packages/mcp-exec/` | MCP server wrapping Exec tool |

### Tool System

Tool handlers return `{ textContent: TOutput; attachments?: ToolAttachmentBlock[] }`. The ToolRegistry destructures `textContent` (sends through transform) and `attachments` (puts in `tool_result.content` as native API content blocks). Each tool defines its output via `output_schema` on `ToolDefinition`.

ReadFile supports binary files (PDF, images) via `mimeType` parameter. Binary content is delivered to the API as native document/image blocks inside the tool result.

### TUI Architecture (MVC + MVVM)

Four roles: Model/State (pure data, owned by whoever updates it), ViewModel/Renderer (pure functions: `(state, cols) → string[]`), View/Display (screen output, reads state), Controller/Input (key routing, writes state).

`main.ts` is the DI container. `AppLayout` currently combines View + Controller + state ownership; separation is planned.

## Conventions

- **TypeScript** throughout
- **Zod** for config validation and tool schemas
- **No DI container** — concrete wiring in `main.ts`
- **No TUI framework** — raw ANSI escape sequences on `process.stdout`
- **JSONL** for audit log
- Build output: `dist/esm/` and `dist/cjs/` via tsup (ESM + CJS + DTS)

## Pull Requests

Every PR must include:

- **Milestone**: `1.0`
- **Reviewer**: `bananabot9000`
- **Assignee**: `shellicar`
- **Label**: one of `bug`, `enhancement`, or `documentation`
- **Package label(s)**: add a `pkg: <name>` label for every package the PR touches
- **Auto-merge**: enable with `gh pr merge --auto --squash`

## Releases & Changelog

Per-package releases. Tag format: `<package-name>@<version>` (e.g. `claude-sdk@1.0.0-beta.1`). Legacy `claude-cli` uses unscoped tags.

Each package has `changes.jsonl` and `CHANGELOG.md`. Add an entry on every PR:

```jsonl
{"description":"What changed","category":"added|changed|deprecated|removed|fixed|security"}
```

`CHANGELOG.md` is generated from `changes.jsonl` via `pnpm tsx scripts/src/generate-changelog.ts <package-dir>`.

### @shellicar/changes tooling

`changes.config.json` defines valid categories. `schema/shellicar-changes.json` is generated from it. Validate with `pnpm tsx scripts/src/validate-changes.ts`. CI runs this automatically.

### Lockstep versioning

All packages share the same version number. If a package has source changes since the last release, it gets bumped to the new version. Packages without changes are not bumped.

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

3. Generate changelogs for each bumped package:
   ```bash
   pnpm tsx scripts/src/generate-changelog.ts <package-dir>
   ```
   The script puts all entries under `[Unreleased]` (no release markers exist). If it produces changes for a package that was not bumped, stop and investigate.

4. Verify: `pnpm build && pnpm type-check && pnpm test && pnpm run ci`

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

GitVersion currently does not produce correct versions in the npm-publish CI workflow. For pre-releases this is not a blocker because package.json is the source of truth and the publish step reads it directly. Temporary diagnostics are included in this release to debug the issue (see npm-publish.yml changes below).

## Linting & Formatting

- **Formatter/linter**: `biome`
- **Git hooks**: `lefthook`
- **Fix command**: `pnpm ci:fix` — never use `pnpm biome check --write` directly
- **Type check**: `pnpm type-check`
- **Build**: `pnpm build`

## Branch Naming

- `feature/` — new functionality
- `fix/` — bug fixes
- `docs/` — documentation-only changes

## Key Patterns

### Tool Handler Contract

Every tool handler returns `{ textContent: TOutput; attachments?: ToolAttachmentBlock[] }`. The `textContent` goes through the transform (ref-swapper for large outputs). Attachments bypass the transform and are placed directly in `tool_result.content` as API content blocks.

### Keypress-Driven Event Loop

`handleKey()` dispatches in priority order: CommandMode → PermissionManager → PromptManager → Editor. No polling.

### Config Hot Reload

File watcher on both config paths (home + local). 100ms debounce. Only reloads during `idle` phase. After reload: `diffConfig()` detects changes.

### System Prompt

`SystemPromptBuilder` collects `SystemPromptProvider` instances. Providers run in parallel via `Promise.all`. Two built-in: `GitProvider` (branch/sha/status) and `UsageProvider` (time/context/cost).

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

## Known Debt

1. **AuditWriter is fatal-on-error** — any write failure calls `process.exit(1)`
2. **thinking/thinkingEffort not tracked by diffConfig** — changes produce no user notification
3. **Slash commands are string-matched** — no command registry
4. **Context thresholds hardcoded** — 85%/90% tool disable thresholds not configurable
5. **No atomic session file writes** — `writeFileSync` is not atomic
6. **AppLayout combines View + Controller** — separation planned
