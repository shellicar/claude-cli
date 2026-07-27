#!/bin/sh
# Generates a self-signed certificate credential for an existing App Registration (created by
# az-sp-create.sh, which deliberately creates the SP with no credential) and stores it in the
# macOS login Keychain under the item apps/claude-sdk-cli/src/secrets/Secrets.ts reads: service
# '@shellicar/credentials', account '<account-name>-cert'.
#
# Owns the certificate's entire local lifecycle in one place: generate, store, delete the temp
# file. The PEM never leaves this script as an argument the operator has to carry between two
# invocations — az ad app credential reset --create-cert writes it to a temp file under $HOME,
# and this script finds that file itself the same way az-sp-create.sh's old combined form did,
# stores its content, then deletes it. Nothing about the cert content ever touches argv or stdout.
#
# Deliberately its own script, separate from az-sp-create.sh: an SP/role only needs creating
# once, but a certificate can need regenerating any number of times after that (rotation, or
# fixing a wrong --account-name) without touching the SP or its role assignment at all.
#
# --account-name is the bare key from sdk-config.json's az.accounts (e.g. 'hopeventures'), and
# --identity is reader|holder — the same two inputs az-sp-create.sh took. This script builds the
# actual Keychain account name itself, 'az-<account-name>-<identity>', matching exactly what
# Secrets.ts's azCert(account, identity) looks up. It is not typed in already-assembled: making
# the operator hand-assemble 'az-hopeventures-reader' themselves is exactly the kind of manual
# string-matching that caused the original bug this pair of scripts replaced.
#
# The Keychain write always overwrites (`security add-generic-password -U`) — this script's only
# job for the Keychain side is "the current cert lives at this account name", so a second run
# against the same --account-name/--identity must always succeed, not be blocked by refusing to
# touch an existing item. --delete-old is unrelated to the Keychain: it only prunes stale Entra AD
# credentials — every credential that existed on the app *before* this run, so old unused certs
# don't pile up on the App Registration after repeated rotation. Off by default: --append (used
# regardless) is always safe on its own, since it only ever adds; --delete-old is the deliberate,
# explicit opt-in to also clean up what preceded it.
#
# --tenant is optional and pins every az call in this script to that Entra tenant, isolated from
# whatever the operator's own ambient `az login` session currently defaults to. Without it, `az ad
# app list`/`az ad app credential reset` run against whatever tenant the ambient session happens
# to be logged into right now — wrong for an operator who is a guest across many tenants (the
# exact failure this flag exists to close: the script silently acting against the wrong tenant's
# app registration). When given, this script logs in fresh, into a throwaway AZURE_CONFIG_DIR
# scoped to this one run, so it never touches or depends on the operator's real `~/.azure` session.
#
# Dry run by default: prints the plan, touches nothing. Pass --apply to actually generate and store.
#
# Usage:
#   .claude/scripts/az-keychain-cert-create.sh --display-name "Hope Ventures (Holder)" --account-name hopeventures --identity holder --tenant <tenant-id>
#   .claude/scripts/az-keychain-cert-create.sh --display-name "Hope Ventures (Holder)" --account-name hopeventures --identity holder --tenant <tenant-id> --apply
#   .claude/scripts/az-keychain-cert-create.sh --display-name "Hope Ventures (Holder)" --account-name hopeventures --identity holder --tenant <tenant-id> --delete-old --apply

set -eu

SERVICE='@shellicar/credentials'
DISPLAY_NAME=''
ACCOUNT_NAME=''
IDENTITY=''
TENANT=''
APPLY=0
DELETE_OLD=0

while [ $# -gt 0 ]; do
  case "$1" in
    --display-name) DISPLAY_NAME="$2"; shift 2 ;;
    --account-name) ACCOUNT_NAME="$2"; shift 2 ;;
    --identity) IDENTITY="$2"; shift 2 ;;
    --tenant) TENANT="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --delete-old) DELETE_OLD=1; shift ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$DISPLAY_NAME" ] || [ -z "$ACCOUNT_NAME" ] || [ -z "$IDENTITY" ]; then
  echo "usage: az-keychain-cert-create.sh --display-name DISPLAY_NAME --account-name ACCOUNT_NAME --identity reader|holder [--delete-old] [--apply]" >&2
  exit 1
fi

case "$IDENTITY" in
  reader | holder) ;;
  *)
    echo "error: --identity must be 'reader' or 'holder', got '$IDENTITY'" >&2
    exit 1
    ;;
esac

ACCOUNT="az-${ACCOUNT_NAME}-${IDENTITY}-cert"

# Isolated, throwaway login for this run only — never the operator's real ~/.azure. Read-only, so
# this runs regardless of --apply: a dry run should report against the actual target tenant, not
# whatever the ambient session happens to default to.
if [ -n "$TENANT" ]; then
  AZURE_CONFIG_DIR=$(mktemp -d)
  export AZURE_CONFIG_DIR
  trap 'rm -rf "$AZURE_CONFIG_DIR"' EXIT
  echo "plan: az login --tenant $TENANT --allow-no-subscriptions (isolated session, this run only)"
  az login --tenant "$TENANT" --allow-no-subscriptions >/dev/null
fi

# Resolved from the display name, not typed in by hand as a GUID — the operator only ever knows
# the app by the display name az-sp-create.sh printed at creation. Read-only, so this runs
# unconditionally, dry run or not. An exact-match filter, and an explicit check for zero or more
# than one match: a display name is not unique in Entra by default, and silently picking
# whichever app came back first would risk generating a credential for the wrong SP entirely.
MATCHES=$(az ad app list --display-name "$DISPLAY_NAME" --query "[?displayName=='$DISPLAY_NAME'].appId" -o tsv)
MATCH_COUNT=$(printf '%s\n' "$MATCHES" | grep -c . || true)

if [ "$MATCH_COUNT" -eq 0 ]; then
  echo "error: no App Registration found with display name '$DISPLAY_NAME'" >&2
  exit 1
fi
if [ "$MATCH_COUNT" -gt 1 ]; then
  echo "error: more than one App Registration has display name '$DISPLAY_NAME' — resolve the ambiguity in Entra before running this script:" >&2
  printf '%s\n' "$MATCHES" >&2
  exit 1
fi
APP_ID="$MATCHES"
echo "resolved: display name '$DISPLAY_NAME' -> appId $APP_ID"

# Read-only, so this runs regardless of --apply: the whole point of a dry run with --delete-old
# is to see the real, current list of what would be removed, not a generic statement that
# something might exist. Queried once, up front, and reused for the actual deletion later so the
# apply path acts on exactly what the plan just showed — not a second, possibly different read.
#
# `az ad app credential list` only ever returns password credentials (client secrets) — it always
# comes back empty for a cert-only app, even when one is visibly attached in the portal.
# Certificates live under the app object's own `keyCredentials` property, which only `az ad app
# show` exposes; that's the source of truth here, not the credential-list command its name
# suggests should cover this.
OLD_CREDS=''
if [ "$DELETE_OLD" -eq 1 ]; then
  OLD_CREDS=$(az ad app show --id "$APP_ID" --query 'keyCredentials[].{keyId:keyId,displayName:displayName,startDateTime:startDateTime,endDateTime:endDateTime}' -o tsv)
fi

echo "plan: az ad app credential reset --id $APP_ID --create-cert --years 1 --append"
echo "plan: store the resulting certificate in Keychain item service='$SERVICE' account='$ACCOUNT' (overwriting any existing value there)"
echo "plan: delete the certificate's temp file once stored"
if [ "$DELETE_OLD" -eq 1 ]; then
  if [ -z "$OLD_CREDS" ]; then
    echo "plan: --delete-old — no pre-existing Entra credentials found on $APP_ID, nothing to remove"
  else
    echo "plan: --delete-old — remove these pre-existing Entra credentials on $APP_ID:"
    printf '%s\n' "$OLD_CREDS" | while IFS="$(printf '\t')" read -r KEY_ID CRED_NAME START END; do
      echo "  keyId=$KEY_ID displayName='$CRED_NAME' start=$START end=$END"
    done
  fi
fi

if [ "$APPLY" -eq 0 ]; then
  echo "dry run only — pass --apply to generate and store"
  exit 0
fi

OLD_KEY_IDS=''
if [ "$DELETE_OLD" -eq 1 ] && [ -n "$OLD_CREDS" ]; then
  OLD_KEY_IDS=$(printf '%s\n' "$OLD_CREDS" | cut -f1)
fi
# `az ad app credential reset --create-cert` ignores cwd and always writes the PEM under $HOME
# (named tmp<random>.pem), regardless of where this script is invoked from. A before/after
# snapshot of $HOME is the only reliable way to find the file it just wrote — cwd or a temp dir
# passed in some other way will not see it.
MARKER=$(mktemp)

OUTPUT=$(az ad app credential reset --id "$APP_ID" --create-cert --years 1 --append --output json)

CERT_FILE=$(find "$HOME" -maxdepth 1 -name 'tmp*.pem' -newer "$MARKER" | head -n1)
rm -f "$MARKER"

if [ -z "$CERT_FILE" ] || [ ! -f "$CERT_FILE" ]; then
  echo "error: no certificate file found under \$HOME newer than this run — az output was:" >&2
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

security add-generic-password -U -s "$SERVICE" -a "$ACCOUNT" -w "$(cat "$CERT_FILE")"
rm -f "$CERT_FILE"

if [ "$DELETE_OLD" -eq 1 ] && [ -n "$OLD_KEY_IDS" ]; then
  for KEY_ID in $OLD_KEY_IDS; do
    # --cert: without it this targets a password credential with this keyId, which never exists
    # for a cert-only app — the delete would silently no-op instead of removing the old key.
    az ad app credential delete --id "$APP_ID" --key-id "$KEY_ID" --cert >/dev/null
    echo "OK: removed Entra credential keyId='$KEY_ID'"
  done
fi

echo "✓ Certificate generated and stored in Keychain"
echo "account: $ACCOUNT"
