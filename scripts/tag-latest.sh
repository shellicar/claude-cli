#!/bin/sh
# Tag a specific package version as "latest" on npm.
# Useful after publishing a pre-release where "latest" was intentionally not updated.
#
# Usage:
#   scripts/tag-latest.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT/apps/$(cat "$REPO_ROOT/.packagename")"
pkg=$(node -e "const p=$(pnpm pkg get name version);process.stdout.write(p.name+'@'+p.version)")

echo "Tagging $pkg as latest..."
npm dist-tag add "$pkg" latest
echo "Done."
