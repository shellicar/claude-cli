#!/bin/sh
# Creates an Entra ID App Registration + Service Principal with a self-signed certificate
# credential (no client secret — --create-password false, so no bearer secret is ever
# generated), assigns an RBAC role, and stores the certificate in the macOS login Keychain
# under the item apps/claude-sdk-cli/src/secrets/Secrets.ts reads (service
# '@shellicar/credentials', account '<name>-cert').
#
# The role is not a free-text argument. --identity reader|holder maps to a fixed role
# (Reader / Contributor) below — there is deliberately nothing else to pass, so a fat-
# fingered role can't happen here. This was a real gap: the script used to take an
# unconstrained --role, so the reader's "unprivileged" status was operator discipline at
# creation time, not anything the tooling actually enforced (the holder's role, by contrast,
# is verified after the fact by az-holder-remove-delete.sh; the reader had no equivalent).
# If a role narrower than these defaults is ever needed, extend the case below rather than
# reopening a free-text hole.
#
# `az login --service-principal --certificate <path>` is the only way this credential is ever
# used; nothing else reads it. The certificate never touches this script's argv or stdout —
# it goes straight from the temp dir az writes it to, into the Keychain, then is deleted.
#
# Dry run by default: prints the plan, touches nothing. Pass --apply to actually create.
#
# Usage:
#   .claude/scripts/az-sp-create.sh --name az-holder --identity holder --scope /subscriptions/<id>
#   .claude/scripts/az-sp-create.sh --name az-holder --identity holder --scope /subscriptions/<id> --apply

set -eu

SERVICE='@shellicar/credentials'
NAME=''
IDENTITY=''
SCOPE=''
APPLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --identity) IDENTITY="$2"; shift 2 ;;
    --scope) SCOPE="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$NAME" ] || [ -z "$IDENTITY" ] || [ -z "$SCOPE" ]; then
  echo "usage: az-sp-create.sh --name NAME --identity reader|holder --scope SCOPE [--apply]" >&2
  exit 1
fi

case "$IDENTITY" in
  reader) ROLE='Reader' ;;
  holder) ROLE='Contributor' ;;
  *)
    echo "error: --identity must be 'reader' or 'holder', got '$IDENTITY'" >&2
    exit 1
    ;;
esac

ACCOUNT="${NAME}-cert"

echo "plan: az ad sp create-for-rbac --name $NAME --role $ROLE --scopes $SCOPE --create-cert --create-password false --years 1"
echo "plan: store resulting certificate in Keychain item service='$SERVICE' account='$ACCOUNT'"
echo "plan: appId/tenantId printed to stdout (non-secret) for sdk-config.json's az.accounts.<account>.* fields — nothing else is printed"

if [ "$APPLY" -eq 0 ]; then
  echo "dry run only — pass --apply to create"
  exit 0
fi

if security find-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null 2>&1; then
  echo "error: Keychain item service='$SERVICE' account='$ACCOUNT' already exists — remove it first if you mean to replace it" >&2
  exit 1
fi

# `az ad sp create-for-rbac --create-cert` ignores cwd and always writes the PEM under $HOME
# (named tmp<random>.pem), regardless of where this script is invoked from. A before/after
# snapshot of $HOME is the only reliable way to find the file it just wrote — cwd or a temp
# dir passed in some other way will not see it.
MARKER=$(mktemp)

OUTPUT=$(az ad sp create-for-rbac --name "$NAME" --role "$ROLE" --scopes "$SCOPE" --create-cert --create-password false --years 1 --output json)

APP_ID=$(printf '%s' "$OUTPUT" | jq -r '.appId')
TENANT_ID=$(printf '%s' "$OUTPUT" | jq -r '.tenant')
CERT_FILE=$(find "$HOME" -maxdepth 1 -name 'tmp*.pem' -newer "$MARKER" | head -n1)
rm -f "$MARKER"

if [ -z "$CERT_FILE" ] || [ ! -f "$CERT_FILE" ]; then
  echo "error: no certificate file found under \$HOME newer than this run — az output was:" >&2
  printf '%s\n' "$OUTPUT" >&2
  exit 1
fi

security add-generic-password -s "$SERVICE" -a "$ACCOUNT" -w "$(cat "$CERT_FILE")"
rm -f "$CERT_FILE"

echo "✓ Service principal created and certificate stored in Keychain"
echo "appId:    $APP_ID"
echo "tenantId: $TENANT_ID"
echo "Add these (non-secret) to sdk-config.json under az.accounts.<account-name>: tenantId, and either readerClientId or holderClientId depending on which identity this is"
