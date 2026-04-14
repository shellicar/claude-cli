# Release versioning — beta and pre-release

**No release markers in `changes.jsonl` for pre-releases.** The SC removed an existing `1.0.0-alpha.1` marker from `claude-sdk-tools` during this process. The pattern is consistent across all packages: no markers for alpha or beta, everything stays `[Unreleased]` until the stable `1.0.0` release. The publish workflow validates the top marker against the release tag, but pre-releases skip that validation anyway. Git tags are the authoritative record of what shipped in each pre-release.

**Run `generate-changelog.ts` on every version bump, not just stable releases.** Even with no release marker the output under `[Unreleased]` is useful and should be kept current.

# Traps

**`pnpm ci` is not the biome check.** `pnpm ci` is intercepted by pnpm's own unimplemented `ci` command. The biome check is `pnpm run ci`.

**Auditing changes against a tag: use `git diff`, not `changes.jsonl` comparison.** `git diff <tag>..HEAD -- <path>/src` shows source-only changes directly. Comparing jsonl at tag time vs HEAD via `git show` is slower and indirect.

**Check `changes.jsonl` completeness before bumping.** A package may have commits with no corresponding `changes.jsonl` entry. Cross-reference `git log <tag>..HEAD --oneline -- <path>` against the jsonl. Add missing entries before bumping.
