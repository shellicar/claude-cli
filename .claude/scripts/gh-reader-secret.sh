#!/bin/sh
# Sets the reader gh PAT into the macOS login Keychain, under the item the CLI reads at
# apps/claude-sdk-cli/src/secrets/Secrets.ts (service '@shellicar/credentials', account 'gh-reader').
#
# This is the token every ordinary exec call runs under (via EnvProvider). It is not "read-only":
# it holds Contents: read-write, so it can push branches. What makes it unprivileged is that it has
# no Pull requests permission at all, so GitHub itself refuses any PR operation on it — the
# restriction is which operations the credential is authorised for, not a read/write split, and
# never enforced by matching the command being run.
#
# The token is read from stdin, never a CLI argument: an argv value is visible to any
# process listing (`ps`), a stdin value is not.
#
# Dry run by default: prints the plan, touches nothing. Pass --apply to actually write.
#
# Usage:
#   printf '%s' "$READER_TOKEN" | .claude/scripts/gh-reader-secret.sh          # dry run
#   printf '%s' "$READER_TOKEN" | .claude/scripts/gh-reader-secret.sh --apply  # writes it

set -eu

SERVICE='@shellicar/credentials'
ACCOUNT='gh-reader'
APPLY=0

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

TOKEN=$(cat)
if [ -z "$TOKEN" ]; then
  echo "no token given on stdin" >&2
  exit 1
fi

if security find-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null 2>&1; then
  EXISTS="yes (will be overwritten, -U)"
else
  EXISTS="no (will be created)"
fi

echo "plan: set Keychain item service='$SERVICE' account='$ACCOUNT'"
echo "existing item: $EXISTS"

if [ "$APPLY" -eq 0 ]; then
  echo "dry run only — pass --apply to write"
  exit 0
fi

security add-generic-password -s "$SERVICE" -a "$ACCOUNT" -w "$TOKEN" -U
echo "written"
