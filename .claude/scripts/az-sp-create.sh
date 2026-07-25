#!/bin/sh
# Creates an Entra ID App Registration + Service Principal with NO credential (no password, no
# certificate — same as leaving both blank in the portal) and assigns an RBAC role. Credential
# generation is a separate script (see az-keychain-cert-create.sh), because SP/role creation and
# certificate lifecycle are different operations with different failure modes: recreating a whole
# SP just to regenerate a cert (rotation, or fixing a wrong Keychain account name) is wasteful and
# invalidates whatever else was already wired to the old SP's appId. This script runs once per SP;
# az-keychain-cert-create.sh can run again any time against the same SP.
#
# --display-name is Entra's own free-text display name (--name on `az ad sp
# create-for-rbac`), shown in the portal, read back by nothing — it is not, and is never meant to
# be, the Keychain account name used later.
#
# The role is not a free-text argument. --identity reader|holder maps to a fixed role below —
# there is deliberately nothing else to pass, so a fat-fingered role can't happen here. The
# holder's role is the custom "Contributor (No Delete)" role (Contributor's own actions minus
# a wildcard */delete NotAction), created here if it doesn't already exist at the target scope
# — not plain Contributor. A holder created with plain Contributor and fixed up afterward by a
# separate script is exactly the gap this script used to have: "unprivileged"/"no delete" must
# be what the tooling creates, not a follow-up step an operator has to remember to run.
#
# Dry run by default: prints the plan, touches nothing. Pass --apply to actually create.
#
# Usage:
#   .claude/scripts/az-sp-create.sh --display-name "Hope Ventures (Holder)" --account-name hopeventures --identity holder --scope /subscriptions/<id>
#   .claude/scripts/az-sp-create.sh --display-name "Hope Ventures (Holder)" --account-name hopeventures --identity holder --scope /subscriptions/<id> --apply
#   .claude/scripts/az-keychain-cert-create.sh --display-name "Hope Ventures (Holder)" --account-name hopeventures --identity holder --apply

set -eu

HOLDER_ROLE_NAME='Contributor (No Delete)'
DISPLAY_NAME=''
ACCOUNT_NAME=''
IDENTITY=''
SCOPE=''
APPLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --display-name) DISPLAY_NAME="$2"; shift 2 ;;
    --account-name) ACCOUNT_NAME="$2"; shift 2 ;;
    --identity) IDENTITY="$2"; shift 2 ;;
    --scope) SCOPE="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$DISPLAY_NAME" ] || [ -z "$ACCOUNT_NAME" ] || [ -z "$IDENTITY" ] || [ -z "$SCOPE" ]; then
  echo "usage: az-sp-create.sh --display-name DISPLAY_NAME --account-name ACCOUNT_NAME --identity reader|holder --scope SCOPE [--apply]" >&2
  exit 1
fi

case "$IDENTITY" in
  reader) ROLE='Reader' ;;
  holder) ROLE="$HOLDER_ROLE_NAME" ;;
  *)
    echo "error: --identity must be 'reader' or 'holder', got '$IDENTITY'" >&2
    exit 1
    ;;
esac

if [ "$IDENTITY" = 'holder' ]; then
  echo "plan: create custom role '$HOLDER_ROLE_NAME' at scope $SCOPE if it doesn't already exist — Contributor's own actions/notActions plus a */delete NotAction"
fi
echo "plan: az ad sp create-for-rbac --name '$DISPLAY_NAME' --role '$ROLE' --scopes $SCOPE --create-password false"
echo "plan: print appId, tenantId to stdout (non-secret) — no credential is created here"
echo "plan: next step (separate, by hand): az-keychain-cert-create.sh --display-name '$DISPLAY_NAME' --account-name $ACCOUNT_NAME --identity $IDENTITY --apply"

if [ "$APPLY" -eq 0 ]; then
  echo "dry run only — pass --apply to create"
  exit 0
fi

if [ "$IDENTITY" = 'holder' ] && ! az role definition list --name "$HOLDER_ROLE_NAME" --scope "$SCOPE" --query '[0].roleName' -o tsv | grep -q .; then
  ROLE_JSON=$(mktemp)
  trap 'rm -f "$ROLE_JSON"' EXIT
  cat > "$ROLE_JSON" <<EOF
{
  "Name": "$HOLDER_ROLE_NAME",
  "IsCustom": true,
  "Description": "Contributor without delete permissions across resource providers.",
  "Actions": ["*"],
  "NotActions": [
    "Microsoft.Authorization/*/Delete",
    "Microsoft.Authorization/*/Write",
    "Microsoft.Authorization/elevateAccess/Action",
    "Microsoft.Blueprint/blueprintAssignments/write",
    "Microsoft.Blueprint/blueprintAssignments/delete",
    "Microsoft.Compute/galleries/share/action",
    "Microsoft.Purview/consents/write",
    "Microsoft.Purview/consents/delete",
    "Microsoft.Resources/deploymentStacks/manageDenySetting/action",
    "Microsoft.Subscription/cancel/action",
    "Microsoft.Subscription/enable/action",
    "*/delete"
  ],
  "DataActions": [],
  "NotDataActions": [],
  "AssignableScopes": ["$SCOPE"]
}
EOF
  az role definition create --role-definition "$ROLE_JSON" >/dev/null
  rm -f "$ROLE_JSON"
  trap - EXIT
  echo "OK: custom role '$HOLDER_ROLE_NAME' created"
fi

OUTPUT=$(az ad sp create-for-rbac --name "$DISPLAY_NAME" --role "$ROLE" --scopes "$SCOPE" --create-password false --output json)

APP_ID=$(printf '%s' "$OUTPUT" | jq -r '.appId')
TENANT_ID=$(printf '%s' "$OUTPUT" | jq -r '.tenant')

if [ "$IDENTITY" = 'reader' ]; then
  READER_FIELD="\"$APP_ID\""
  HOLDER_FIELD='null'
else
  READER_FIELD='null'
  HOLDER_FIELD="\"$APP_ID\""
fi

echo "✓ Service principal created, no credential yet"
echo "appId:     $APP_ID"
echo "tenantId:  $TENANT_ID"
echo "Merge this into sdk-config.json (it only fills the $IDENTITY field — fill the other identity's clientId when its own SP exists, or leave it null):"
jq -n --arg account "$ACCOUNT_NAME" --arg tenantId "$TENANT_ID" --argjson reader "$READER_FIELD" --argjson holder "$HOLDER_FIELD" '{az: {accounts: {($account): {tenantId: $tenantId, readerClientId: $reader, holderClientId: $holder}}}}'
echo "Then generate and store its certificate: az-keychain-cert-create.sh --display-name '$DISPLAY_NAME' --account-name $ACCOUNT_NAME --identity $IDENTITY --apply"
