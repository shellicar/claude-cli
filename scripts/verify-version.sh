#!/bin/sh
# Verify that package.json version matches gitversion
#
# Usage:
#   scripts/verify-version.sh

set -e

# Get full version from package.json
full_version=$(node -p "JSON.parse(require('fs').readFileSync('package.json')).version")

# Extract base version (x.y.z) stripping any prerelease suffix
base_version=$(echo "$full_version" | sed 's/^\([0-9]\+\.[0-9]\+\.[0-9]\+\).*/\1/')

# Get version from gitversion
if command -v gitversion >/dev/null 2>&1; then
  GITVERSION=gitversion
elif command -v dotnet-gitversion >/dev/null 2>&1; then
  GITVERSION=dotnet-gitversion
else
  echo "❌ gitversion not found" >&2
  exit 1
fi

gitversion_output=$($GITVERSION /showvariable SemVer)

if [ "$base_version" = "$gitversion_output" ]; then
  echo "✅ Version match: $base_version (package.json: $full_version)"
else
  echo "❌ Version mismatch" >&2
  echo "  package.json base: $base_version (full: $full_version)" >&2
  echo "  gitversion:        $gitversion_output" >&2
  exit 1
fi
