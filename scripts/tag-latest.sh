#!/bin/sh
# Tag a specific package version as "latest" on npm.
# Useful after publishing a pre-release where "latest" was intentionally not updated.
#
# Usage:
#   scripts/tag-latest.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

pkg=$(node -p "const p = require('$SCRIPT_DIR/../package.json'); p.name + '@' + p.version")

echo "Tagging $pkg as latest..."
npm dist-tag add "$pkg" latest
echo "Done."
