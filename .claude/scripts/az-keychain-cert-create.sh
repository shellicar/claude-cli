#!/bin/sh
# Generates a self-signed certificate credential for an existing App Registration (created by
# az-sp-create.sh, which deliberately creates the SP with no credential) and stores it in the
# macOS login Keychain under the item apps/claude-sdk-cli/src/secrets/Secrets.ts reads: service
# '@shellicar/credentials', account 'az-<account-name>-<identity>-cert'.
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
# actual Keychain account name itself, 'az-<account-name>-<identity>-cert', matching exactly what
# Secrets.ts's azCert(account, identity) looks up. It is not typed in already-assembled: making
# the operator hand-assemble 'az-hopeventures-reader' themselves is exactly the kind of manual
# string-matching that caused the original bug this pair of scripts replaced.
#
# Idempotent, and the check is exact rather than a guess about what a previous run did. The
# certificate stored in the Keychain is read back, its SHA-1 thumbprint computed, and compared
# against the base64 customKeyIdentifier of each certificate credential on the App Registration.
# So the script knows the difference between nothing stored, something stored that the app does
# not accept, and the right certificate already in place. A matching, unexpired certificate means
# there is no work to do and the run is a no-op.
#
# Mismatched certificates were the failure this check exists to close: a Keychain item and an app
# registration that had drifted apart looked identical to one that was fine, and nothing short of
# an authentication attempt would tell you which you had.
#
# A certificate within 30 days of expiring counts as work to do, so ordinary re-runs renew it
# before it lapses rather than after.
#
# --rotate forces a new certificate even when the stored one is valid. Needed because generating
# is no longer what a bare run does.
#
# --delete-old prunes stale Entra AD credentials — every credential that existed on the app
# *before* this run — and has nothing to do with the Keychain item, which is always overwritten.
#
# --tenant is required and pins every az call in this script to that Entra tenant, in an
# AZURE_CONFIG_DIR isolated from the operator's real `~/.azure`. Were it not pinned, `az ad app
# list`/`az ad app credential reset` would run against whatever tenant the ambient session happens
# to be logged into right now — wrong for an operator who is a guest across many tenants, and
# silent when it goes wrong: the script would act against the wrong tenant's app registration and
# report success. See lib/az-session.sh for how the session is derived and reused.
#
# Dry run by default: prints the plan, touches nothing. Pass --apply to actually generate and store.
#
# Usage:
#   .claude/scripts/az-keychain-cert-create.sh --tenant <tenant-id> --display-name "Hope Ventures (Holder)" --account-name hopeventures --identity holder
#   .claude/scripts/az-keychain-cert-create.sh --tenant <tenant-id> --display-name "Hope Ventures (Holder)" --account-name hopeventures --identity holder --apply
#   .claude/scripts/az-keychain-cert-create.sh --tenant <tenant-id> --display-name "Hope Ventures (Holder)" --account-name hopeventures --identity holder --rotate --delete-old --apply

set -eu

SERVICE='@shellicar/credentials'
DISPLAY_NAME=''
ACCOUNT_NAME=''
IDENTITY=''
TENANT=''
APPLY=0
DELETE_OLD=0
DELETE_OLD_ARG=''
ROTATE=0
ROTATE_ARG=''
EXPIRY_DAYS=30

while [ $# -gt 0 ]; do
  case "$1" in
    --display-name | --account-name | --identity | --tenant)
      if [ $# -lt 2 ]; then
        echo "error: $1 requires a value" >&2
        exit 1
      fi
      ;;
  esac

  case "$1" in
    --display-name) DISPLAY_NAME="$2"; shift 2 ;;
    --account-name) ACCOUNT_NAME="$2"; shift 2 ;;
    --identity) IDENTITY="$2"; shift 2 ;;
    --tenant) TENANT="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --delete-old) DELETE_OLD=1; DELETE_OLD_ARG=' --delete-old'; shift ;;
    --rotate) ROTATE=1; ROTATE_ARG=' --rotate'; shift ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$TENANT" ] || [ -z "$DISPLAY_NAME" ] || [ -z "$ACCOUNT_NAME" ] || [ -z "$IDENTITY" ]; then
  echo "usage: az-keychain-cert-create.sh --tenant TENANT --display-name DISPLAY_NAME --account-name ACCOUNT_NAME --identity reader|holder [--rotate] [--delete-old] [--apply]" >&2
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

# Read-only calls happen below regardless of --apply, so the session is established
# unconditionally: a dry run should report against the actual target tenant, not whatever the
# ambient session happens to default to.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/lib/az-session.sh"
az_session_begin "$TENANT"

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
echo "✅ App Registration '$DISPLAY_NAME' resolved to appId $APP_ID"

# `az ad app credential list` only ever returns password credentials (client secrets) — it always
# comes back empty for a cert-only app, even when one is visibly attached in the portal.
# Certificates live under the app object's own `keyCredentials` property, which only `az ad app
# show` exposes; that's the source of truth here, not the credential-list command its name
# suggests should cover this.
OLD_CREDS=$(az ad app show --id "$APP_ID" --query 'keyCredentials[].{keyId:keyId,customKeyIdentifier:customKeyIdentifier,displayName:displayName,startDateTime:startDateTime,endDateTime:endDateTime}' -o tsv)

STORED_PEM=$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w 2>/dev/null || true)

# `security ... -w` prints the password as one long hex string instead of its raw bytes whenever
# the data is multi-line, which a PEM always is. Nothing is wrong with what was stored — this is
# purely how the command-line tool renders it, and keychain-native reads the same item through the
# macOS API and gets the raw bytes. Detected by content rather than by a flag, because there is no
# option to turn it off: a PEM contains '-', '/' and newlines, so anything that is nothing but hex
# digits is the encoded form.
case "$STORED_PEM" in
  '') ;;
  *[!0-9a-fA-F]*) ;;
  *) STORED_PEM=$(printf '%s' "$STORED_PEM" | xxd -r -p) ;;
esac

# The SHA-1 fingerprint is what ties the two together: Entra records each certificate credential's
# SHA-1 thumbprint in customKeyIdentifier, and the stored PEM is that same certificate. Comparing
# them is exact — either the app accepts what is stored, or it does not.
STORED_THUMBPRINT=''
if [ -n "$STORED_PEM" ]; then
  STORED_THUMBPRINT=$(printf '%s\n' "$STORED_PEM" | openssl x509 -noout -fingerprint -sha1 2>/dev/null | sed 's/^.*=//' | tr -d ':' | tr '[:lower:]' '[:upper:]' || true)
fi

# Fed by here-document rather than a pipe: a `... | while read` loop runs in a subshell, so the
# match it found would be lost the moment the loop ended.
MATCH_KEY_ID=''
MATCH_END=''
if [ -n "$STORED_THUMBPRINT" ] && [ -n "$OLD_CREDS" ]; then
  while IFS="$(printf '\t')" read -r KEY_ID CKI CRED_NAME START END; do
    [ -n "$CKI" ] || continue
    # az prints customKeyIdentifier as a hex thumbprint, while raw Microsoft Graph returns the
    # same bytes base64-encoded. Which one arrives here depends on the CLI version, and
    # base64-decoding a value that is already hex turns an exact match into garbage, so the form
    # is detected rather than assumed: a SHA-1 thumbprint in hex is 40 hex digits and nothing
    # else, where its base64 form is 28 characters ending in '='.
    case "$CKI" in
      [0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F])
        CKI_HEX=$(printf '%s' "$CKI" | tr '[:lower:]' '[:upper:]')
        ;;
      *)
        CKI_HEX=$(printf '%s' "$CKI" | openssl base64 -d -A 2>/dev/null | od -An -tx1 | tr -d ' \n' | tr '[:lower:]' '[:upper:]' || true)
        ;;
    esac
    if [ "$CKI_HEX" = "$STORED_THUMBPRINT" ]; then
      MATCH_KEY_ID="$KEY_ID"
      MATCH_END="$END"
    fi
  done <<EOF
$OLD_CREDS
EOF
fi

# BSD and GNU date take different flags for arithmetic, and these scripts run on both. Compared as
# YYYYMMDDHHMMSS integers so no date parsing is needed on the other side, only digit extraction.
EXPIRY_THRESHOLD=$(date -u -v+${EXPIRY_DAYS}d '+%Y%m%d%H%M%S' 2>/dev/null || date -u -d "+$EXPIRY_DAYS days" '+%Y%m%d%H%M%S')
MATCH_END_NUM=$(printf '%s' "$MATCH_END" | tr -dc '0-9' | cut -c1-14)

NEED_CERT=1
if [ "$ROTATE" -eq 1 ]; then
  REASON='--rotate was given'
elif [ -z "$STORED_PEM" ]; then
  REASON="nothing is stored in Keychain item account='$ACCOUNT'"
elif [ -z "$STORED_THUMBPRINT" ]; then
  REASON="the value stored at '$ACCOUNT' is not a readable certificate"
elif [ -z "$MATCH_KEY_ID" ]; then
  REASON="the certificate stored at '$ACCOUNT' is not one this App Registration accepts"
elif [ "$MATCH_END_NUM" -lt "$EXPIRY_THRESHOLD" ]; then
  REASON="the stored certificate expires $MATCH_END, within $EXPIRY_DAYS days"
else
  NEED_CERT=0
fi

if [ "$NEED_CERT" -eq 0 ]; then
  echo "✅ the certificate stored at '$ACCOUNT' is credential $MATCH_KEY_ID on $APP_ID, valid until $MATCH_END"
  echo "✅ Nothing to do — running this with --apply would change nothing (pass --rotate to replace it anyway)"
  exit 0
fi

if [ "$APPLY" -eq 0 ]; then
  echo "⚡ generate a new certificate on $APP_ID (valid 1 year) — $REASON"
  echo "⚡ store it in Keychain item service='$SERVICE' account='$ACCOUNT', overwriting any existing value"

  # --append means the app ends up holding the pre-existing credentials plus the new one. Only the
  # pre-existing ones that survive are worth saying anything about, so this reports what is
  # actually on the app rather than describing the flag's behaviour.
  if [ -n "$OLD_CREDS" ]; then
    if [ "$DELETE_OLD" -eq 1 ]; then
      echo "🗑️  remove these pre-existing Entra credentials on $APP_ID:"
    else
      echo "⚠️  these pre-existing Entra credentials stay on $APP_ID alongside the new one — pass --delete-old to remove them:"
    fi
    printf '%s\n' "$OLD_CREDS" | while IFS="$(printf '\t')" read -r KEY_ID CKI CRED_NAME START END; do
      echo "   keyId=$KEY_ID displayName='$CRED_NAME' start=$START end=$END"
    done
  fi

  echo ""
  echo "to apply, re-run:"
  echo "$0 --tenant $TENANT --display-name '$DISPLAY_NAME' --account-name $ACCOUNT_NAME --identity $IDENTITY$DELETE_OLD_ARG$ROTATE_ARG --apply"
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
    echo "✅ removed Entra credential keyId='$KEY_ID'"
  done
fi

echo "✅ Certificate generated and stored in Keychain item '$ACCOUNT'"

if [ "$DELETE_OLD" -eq 0 ] && [ -n "$OLD_CREDS" ]; then
  echo "⚠️  the credentials that were already on $APP_ID are still there — re-run with --delete-old to remove them"
fi
