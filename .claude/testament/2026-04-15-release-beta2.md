# 07:50

Release `1.0.0-beta.2` — phase 1 (version bump).

## What changed since beta.1

All four packages had commits since their respective `*@1.0.0-beta.1` tags.

**packages/claude-sdk** (4 commits): finalMessage event emitter, CompactConfig type, COMPACT_BETA constant replacing enum member, omit empty context_management from request body.

**packages/claude-sdk-tools** (2 commits): appendFile added to IFileSystem/NodeFileSystem/MemoryFileSystem (#253), TypeScript language tools TsDiagnostics/TsHover/TsReferences/TsDefinition (#264).

**packages/claude-core** (1 commit): package.json metadata fix (#250, missing keywords/homepage/repo). No source changes. No changes.jsonl entry added — SC confirmed not necessary.

**apps/claude-sdk-cli** (5 commits): Write BetaMessage per turn, compact config, --init-config fix, image paste, TypeScript tools registered in main.ts. The last one (#264) had no changes.jsonl entry — added it before bumping.

## Cross-reference process

Used `git show <tag>:<path>/changes.jsonl` to compare the file at tag time vs HEAD, then matched against git log. SC pointed out the simpler approach: `git diff <tag>..HEAD -- <path>/src` to show source-only changes directly. Use that next time.

## Release markers — pre-releases only

No release markers in changes.jsonl for any pre-release (alpha or beta). The SC removed the 1.0.0-alpha.1 marker that existed in claude-sdk-tools — consistent pattern across all packages. Pre-releases aren't validated by the publish workflow, the markers would be replaced at 1.0.0 anyway, and git tags are the authoritative source of what shipped in each pre-release. Everything stays unreleased until the stable release.

## Changelog generation

Run `generate-changelog.ts` for all four packages as part of every version bump, not just stable releases. It updates CHANGELOG.md with the current unreleased entries. With no release marker, new entries appear under `[Unreleased]` — still useful and should be kept current.

## Verification

- `pnpm build`: pass
- `pnpm type-check`: pass
- `pnpm test`: pass
- `pnpm run ci` (biome): pass — note: `pnpm ci` is intercepted by pnpm's own unimplemented ci command; must use `pnpm run ci`
- `validate-changes.ts`: pass

## Staged

- `apps/claude-sdk-cli/changes.jsonl` (added missing TS tools entry)
- `apps/claude-sdk-cli/package.json`
- `packages/claude-core/package.json`
- `packages/claude-sdk-tools/package.json`
- `packages/claude-sdk/package.json`
