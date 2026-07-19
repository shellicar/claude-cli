#!/bin/sh
# Replaces an identity's built-in Contributor role assignment with a custom "Contributor (No
# Delete)" role at the same scope: same actions as Contributor, minus a wildcard `*/delete`
# NotAction, so it can create and modify resources but never delete any of them.
#
# The custom role is created once per subscription (skipped if it already exists) and is
# assignable at that subscription only.
#
# Dry run by default: prints the plan, touches nothing. Pass --apply to actually change anything.
#
# Usage:
#   .claude/scripts/az-holder-remove-delete.sh --principal-id <id> --subscription <sub-id>
#   .claude/scripts/az-holder-remove-delete.sh --principal-id <id> --subscription <sub-id> --apply

set -eu

ROLE_NAME='Contributor (No Delete)'

PRINCIPAL_ID=''
SUBSCRIPTION=''
APPLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --principal-id) PRINCIPAL_ID="$2"; shift 2 ;;
    --subscription) SUBSCRIPTION="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$PRINCIPAL_ID" ] || [ -z "$SUBSCRIPTION" ]; then
  echo "usage: az-holder-remove-delete.sh --principal-id ID --subscription SUBSCRIPTION_ID [--apply]" >&2
  exit 1
fi

SCOPE="/subscriptions/$SUBSCRIPTION"

echo "plan: create custom role '$ROLE_NAME' at scope $SCOPE (skipped if it already exists) -- Contributor's own actions/notActions plus a */delete NotAction"
echo "plan: az role assignment delete --assignee '$PRINCIPAL_ID' --role Contributor --scope '$SCOPE'"
echo "plan: az role assignment create --assignee '$PRINCIPAL_ID' --role '$ROLE_NAME' --scope '$SCOPE'"

if [ "$APPLY" -eq 0 ]; then
  echo "dry run only -- pass --apply to make the change"
  exit 0
fi

if ! az role definition list --name "$ROLE_NAME" --scope "$SCOPE" --query '[0].roleName' -o tsv | grep -q .; then
  ROLE_JSON=$(mktemp)
  trap 'rm -f "$ROLE_JSON"' EXIT
  cat > "$ROLE_JSON" <<EOF
{
  "Name": "$ROLE_NAME",
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
  echo "OK: custom role '$ROLE_NAME' created"
else
  echo "OK: custom role '$ROLE_NAME' already exists, reusing it"
fi

az role assignment delete --assignee "$PRINCIPAL_ID" --role Contributor --scope "$SCOPE"
echo "OK: Contributor assignment removed"

az role assignment create --assignee "$PRINCIPAL_ID" --role "$ROLE_NAME" --scope "$SCOPE" >/dev/null
echo "OK: '$ROLE_NAME' assignment created"
