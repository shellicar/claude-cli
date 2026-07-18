#!/bin/sh
# Removes your broad personal gh login (service 'gh:github.com' in the login Keychain,
# currently scoped gist/read:org/repo/workflow — 'repo' alone is enough to open, merge, and
# review PRs) and optionally replaces it with the scoped agent-read PAT, so `gh` run as you
# is no longer a path to a full-access token.
#
# This is why plain `gh auth logout` isn't the fix: it clears gh's own stored login, but
# nothing stops a command run as you from doing `gh auth login` again, or from reading
# GH_TOKEN/GITHUB_TOKEN if one is set, or from pulling the raw secret straight out of the
# Keychain item directly (`security find-generic-password -s gh:github.com -w`). Purging the
# item and replacing it with a token that structurally cannot open a PR closes the actual gap.
#
# Dry run by default: prints the plan, touches nothing. Pass --apply to act.
#
# Usage:
#   .claude/scripts/gh-purge-standard-credential.sh                                    # dry run
#   .claude/scripts/gh-purge-standard-credential.sh --apply                            # logout + purge only
#   printf '%s' "$AGENT_READ_TOKEN" | .claude/scripts/gh-purge-standard-credential.sh --apply --relogin
#     # logout + purge + re-login gh as the scoped agent-read token (reads it from stdin)

set -eu

SERVICE='gh:github.com'
APPLY=0
RELOGIN=0

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --relogin) RELOGIN=1 ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

echo "current gh auth status:"
gh auth status 2>&1 || true
echo

if security find-generic-password -s "$SERVICE" >/dev/null 2>&1; then
  FOUND="yes"
else
  FOUND="no"
fi
echo "Keychain item service='$SERVICE': $FOUND"
echo

echo "plan:"
echo "  1. gh auth logout --hostname github.com"
echo "  2. delete Keychain item service='$SERVICE' (any account)"
if [ "$RELOGIN" -eq 1 ]; then
  echo "  3. gh auth login --hostname github.com --with-token < (token from stdin)"
else
  echo "  3. (skipped — pass --relogin to re-login gh with a scoped read-only token)"
fi

if [ "$APPLY" -eq 0 ]; then
  echo
  echo "dry run only — pass --apply to act"
  exit 0
fi

if [ "$RELOGIN" -eq 1 ]; then
  TOKEN=$(cat)
  if [ -z "$TOKEN" ]; then
    echo "no token given on stdin" >&2
    exit 1
  fi
fi

gh auth logout --hostname github.com || true
security delete-generic-password -s "$SERVICE" 2>/dev/null || echo "no Keychain item to delete"

if [ "$RELOGIN" -eq 1 ]; then
  printf '%s' "$TOKEN" | gh auth login --hostname github.com --with-token
  echo "re-logged in with the supplied token"
fi

echo "done"
