#!/bin/sh
# Creates an Entra ID App Registration + Service Principal with NO credential (no password, no
# certificate — same as leaving both blank in the portal) and reconciles its RBAC role
# assignments to the scopes you pass.
#
# One of three scripts, split by lifecycle. az-role-create.sh owns the custom role definition,
# which is a single tenant-level object shared by every SP assigned it. This script owns the SP
# and its assignments. az-keychain-cert-create.sh owns the certificate, which rotates repeatedly
# without the SP changing at all. Recreating an SP to regenerate a cert would invalidate whatever
# else was already wired to the old appId; rewriting a shared role definition to add one SP's
# scope would change permissions for every other SP using it.
#
# --display-name is Entra's own free-text display name, shown in the portal. It is also this
# script's identity key: the app is looked up by it, created only when no match exists, and
# reused otherwise. That is what makes repeated runs safe. Entra permits duplicate display names,
# so an ambiguous match is a hard error rather than a guess — generating credentials for the
# wrong SP is not a failure you want discovered later.
#
# The role is not a free-text argument. --identity reader|holder maps to a fixed role: reader
# gets the built-in Reader, holder gets the custom "Contributor (No Delete)" role, which must
# already exist — run az-role-create.sh first. A holder created with plain Contributor and fixed
# up afterward by a separate script is exactly the gap this pair used to have: "unprivileged" and
# "no delete" must be what the tooling creates, not a follow-up step someone has to remember.
#
# Idempotent. --scope is repeatable and describes the desired assignments. By default the script
# is additive: it creates assignments that are missing and reports — but does not remove —
# assignments this principal holds that you did not pass. --remove-extra opts in to removing
# them. Removal is destructive and a role assignment may have been made deliberately elsewhere,
# so it is never what a bare run does.
#
# A scope is a subscription, a resource group, or a management group
# (/providers/Microsoft.Management/managementGroups/<id>). A management group scope is inherited
# by every subscription beneath it, including ones created later.
#
# The holder additionally requests the Microsoft Graph 'User.Read.All' application permission,
# which the reader never gets. Requested only — admin consent is a privileged act for a person
# with Global Administrator or Privileged Role Administrator, so the script asks for the
# permission and warns while consent is outstanding, rather than granting it.
#
# --tenant is required and pins every az call to that Entra tenant, in an AZURE_CONFIG_DIR
# isolated from the operator's real ~/.azure. It matters most here: an app looked up in the wrong
# directory is simply not found, and this script would helpfully create a second one there. See
# lib/az-session.sh for how the session is derived and reused.
#
# Dry run by default: prints the plan, touches nothing. Pass --apply to actually create.
#
# Usage:
#   .claude/scripts/az-sp-create.sh --tenant <tenant-id> --display-name "Hope Ventures (Reader)" --account-name hopeventures --identity reader --scope /subscriptions/<id>
#   .claude/scripts/az-sp-create.sh --tenant <tenant-id> --display-name "Hope Ventures (Reader)" --account-name hopeventures --identity reader --scope /subscriptions/<id> --scope /providers/Microsoft.Management/managementGroups/<mg> --apply
#   .claude/scripts/az-keychain-cert-create.sh --tenant <tenant-id> --display-name "Hope Ventures (Reader)" --account-name hopeventures --identity reader --apply

set -eu

HOLDER_ROLE_NAME='Contributor (No Delete)'
GRAPH_APP_ID='00000003-0000-0000-c000-000000000000'
GRAPH_PERMISSION='User.Read.All'
TENANT=''
DISPLAY_NAME=''
ACCOUNT_NAME=''
IDENTITY=''
SCOPES=''
SCOPE_ARGS=''
APPLY=0
REMOVE_EXTRA=0
REMOVE_EXTRA_ARG=''

while [ $# -gt 0 ]; do
  # Checked before the case below reads $2, because `set -u` turns a flag with no value into a
  # bare "$2: unbound variable" shell error rather than anything that says which flag was wrong.
  case "$1" in
    --tenant | --display-name | --account-name | --identity | --scope)
      if [ $# -lt 2 ]; then
        echo "error: $1 requires a value" >&2
        exit 1
      fi
      ;;
  esac

  case "$1" in
    --tenant) TENANT="$2"; shift 2 ;;
    --display-name) DISPLAY_NAME="$2"; shift 2 ;;
    --account-name) ACCOUNT_NAME="$2"; shift 2 ;;
    --identity) IDENTITY="$2"; shift 2 ;;
    --scope) SCOPES="${SCOPES:+$SCOPES }$2"; SCOPE_ARGS="${SCOPE_ARGS:+$SCOPE_ARGS }--scope $2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --remove-extra) REMOVE_EXTRA=1; REMOVE_EXTRA_ARG=' --remove-extra'; shift ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$TENANT" ] || [ -z "$DISPLAY_NAME" ] || [ -z "$ACCOUNT_NAME" ] || [ -z "$IDENTITY" ] || [ -z "$SCOPES" ]; then
  echo "usage: az-sp-create.sh --tenant TENANT --display-name DISPLAY_NAME --account-name ACCOUNT_NAME --identity reader|holder --scope SCOPE [--scope SCOPE ...] [--remove-extra] [--apply]" >&2
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

# Read-only calls happen below regardless of --apply, so the session is established
# unconditionally: a dry run must report against the actual target tenant, not whatever the
# ambient session defaults to.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/lib/az-session.sh"
az_session_begin "$TENANT"

# Word splitting on $SCOPES is deliberate throughout: these are jq positional arguments, and an
# Azure resource ID can contain neither a space nor a newline.
FIRST_SCOPE=${SCOPES%% *}

if [ "$IDENTITY" = 'holder' ] && ! az role definition list --name "$HOLDER_ROLE_NAME" --scope "$FIRST_SCOPE" --custom-role-only true --query '[0].roleName' -o tsv | grep -q .; then
  echo "error: custom role '$HOLDER_ROLE_NAME' does not exist at $FIRST_SCOPE — create it first: az-role-create.sh --tenant $TENANT --scope $FIRST_SCOPE --apply" >&2
  exit 1
fi

# Read-only, so this runs regardless of --apply: a dry run should report against the app that
# actually exists, not describe a creation that may not be what happens. An exact-match filter
# and an explicit count check, because a display name is not unique in Entra by default.
MATCHES=$(az ad app list --display-name "$DISPLAY_NAME" --query "[?displayName=='$DISPLAY_NAME'].appId" -o tsv)
MATCH_COUNT=$(printf '%s\n' "$MATCHES" | grep -c . || true)

if [ "$MATCH_COUNT" -gt 1 ]; then
  echo "error: more than one App Registration has display name '$DISPLAY_NAME' — resolve the ambiguity in Entra before running this script:" >&2
  printf '%s\n' "$MATCHES" >&2
  exit 1
fi

# Counts what --apply would actually change, so a dry run can say whether there is any point
# running it again with --apply.
PENDING=0

# Intent is what a dry run is for. Under --apply the same facts appear again as outcomes, and two
# versions of the same list is what makes an apply hard to read, so --apply prints only what has
# actually happened.
plan() {
  if [ "$APPLY" -eq 0 ]; then
    echo "$1"
  fi
}

APP_ID=''
if [ "$MATCH_COUNT" -eq 1 ]; then
  APP_ID="$MATCHES"
  echo "✅ App Registration '$DISPLAY_NAME' exists (appId $APP_ID)"
else
  plan "⚡ create App Registration '$DISPLAY_NAME' (no credential — see az-keychain-cert-create.sh)"
  PENDING=$((PENDING + 1))
fi

# An App Registration and its Service Principal are separate objects, and an app can exist
# without one — created by hand in the portal, or left behind by a partial earlier run. So the
# SP is checked and created independently of the app rather than assumed to follow it.
OBJECT_ID=''
if [ -n "$APP_ID" ]; then
  OBJECT_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv 2>/dev/null || true)
fi

if [ -n "$OBJECT_ID" ]; then
  echo "✅ Service Principal exists (objectId $OBJECT_ID)"
else
  plan "⚡ create Service Principal"
  PENDING=$((PENDING + 1))
fi

# Assignments are listed for the principal rather than per scope, so an assignment at a scope you
# did not pass is visible at all — that is the whole point of reconciling. It reports only what
# the calling identity can read, so run this as an account with read across the scopes involved
# or an "extra" assignment may simply be invisible rather than absent.
EXISTING_ASSIGNMENTS='[]'
if [ -n "$OBJECT_ID" ]; then
  EXISTING_ASSIGNMENTS=$(az role assignment list --assignee "$APP_ID" --all --query '[].{id: id, role: roleDefinitionName, scope: scope}' --output json)
fi

DESIRED=$(jq -n --arg role "$ROLE" --args '[$ARGS.positional[] | {role: $role, scope: .}]' -- $SCOPES)
MISSING=$(printf '%s' "$DESIRED" | jq -r --argjson existing "$EXISTING_ASSIGNMENTS" '[.[] | . as $d | select(($existing | map({role: .role, scope: .scope})) | index($d) | not)] | .[].scope')
EXTRA=$(printf '%s' "$EXISTING_ASSIGNMENTS" | jq -r --argjson desired "$DESIRED" '[.[] | . as $a | select(($desired | index({role: $a.role, scope: $a.scope})) | not)] | .[] | "\(.id)\t\(.role)\t\(.scope)"')

if [ -n "$MISSING" ]; then
  PENDING=$((PENDING + $(printf '%s\n' "$MISSING" | grep -c .)))
fi
if [ -n "$EXTRA" ] && [ "$REMOVE_EXTRA" -eq 1 ]; then
  PENDING=$((PENDING + $(printf '%s\n' "$EXTRA" | grep -c .)))
fi

if [ -z "$MISSING" ]; then
  echo "✅ every '$ROLE' assignment you passed already exists"
else
  plan "⚡ create '$ROLE' assignments at:"
  if [ "$APPLY" -eq 0 ]; then
    printf '   %s\n' $MISSING
  fi
fi

if [ -z "$EXTRA" ]; then
  echo "✅ this principal holds no assignments outside the ones you passed"
elif [ "$APPLY" -eq 0 ]; then
  if [ "$REMOVE_EXTRA" -eq 1 ]; then
    echo "🗑️  remove these assignments, which you did not pass:"
  else
    echo "⚠️  this principal holds assignments you did not pass — left alone, pass --remove-extra to remove them:"
  fi
  printf '%s\n' "$EXTRA" | while IFS="$(printf '\t')" read -r A_ID A_ROLE A_SCOPE; do
    echo "   role='$A_ROLE' scope=$A_SCOPE"
  done
elif [ "$REMOVE_EXTRA" -eq 0 ]; then
  echo "⚠️  this principal holds assignments you did not pass — re-run with --remove-extra to remove them"
fi

# Microsoft Graph is a separate permission system from Azure RBAC: a role on a subscription or
# management group grants nothing at all against graph.microsoft.com. The holder needs directory
# read, so it is requested here; the reader deliberately gets no Graph permissions.
#
# The script only ever *requests* the permission. Granting it is admin consent, which needs
# Global Administrator or Privileged Role Administrator and is a decision a person makes, not
# something tooling should do on their behalf. What the script owes you is knowing whether it has
# happened, because a requested-but-unconsented permission looks configured in the portal and
# fails at runtime.
GRAPH_ROLE_ID=''
PERMISSION_REQUESTED=0
PERMISSION_CONSENTED=0

if [ "$IDENTITY" = 'holder' ]; then
  # Resolved from Graph rather than hardcoded. The well-known GUID for this permission is easy to
  # find and easy to get subtly wrong, and a wrong one fails at consent time rather than here.
  GRAPH_ROLE_ID=$(az ad sp show --id "$GRAPH_APP_ID" --query "appRoles[?value=='$GRAPH_PERMISSION' && contains(allowedMemberTypes, 'Application')].id | [0]" -o tsv)
  if [ -z "$GRAPH_ROLE_ID" ]; then
    echo "error: could not resolve the '$GRAPH_PERMISSION' application permission id from Microsoft Graph" >&2
    exit 1
  fi

  if [ -n "$APP_ID" ] && az ad app show --id "$APP_ID" --query "requiredResourceAccess[?resourceAppId=='$GRAPH_APP_ID'].resourceAccess[] | [?id=='$GRAPH_ROLE_ID'].id" -o tsv | grep -q .; then
    PERMISSION_REQUESTED=1
  fi

  # Consent shows up as an app role assignment on the service principal, not on the app
  # registration — the request and the grant live on two different objects.
  if [ -n "$OBJECT_ID" ] && az rest --method get --url "https://graph.microsoft.com/v1.0/servicePrincipals/$OBJECT_ID/appRoleAssignments" --query "value[?appRoleId=='$GRAPH_ROLE_ID'].id" -o tsv 2>/dev/null | grep -q .; then
    PERMISSION_CONSENTED=1
  fi

  if [ "$PERMISSION_REQUESTED" -eq 1 ]; then
    echo "✅ Microsoft Graph '$GRAPH_PERMISSION' is requested on the app registration"
  else
    plan "⚡ request Microsoft Graph '$GRAPH_PERMISSION' (application permission) on the app registration"
    PENDING=$((PENDING + 1))
  fi

  if [ "$PERMISSION_CONSENTED" -eq 1 ]; then
    echo "✅ admin consent for '$GRAPH_PERMISSION' has been granted"
  else
    echo "⚠️  admin consent for '$GRAPH_PERMISSION' has not been granted — nothing uses the permission until a Global Administrator or Privileged Role Administrator grants it in Entra"
  fi
fi

# The only next step a dry run has is applying itself. Naming the certificate script here instead
# reads as the thing to do next and sends the operator to a script that cannot work yet, because
# the App Registration it looks up does not exist until this one has been applied.
if [ "$APPLY" -eq 0 ]; then
  if [ "$PENDING" -eq 0 ]; then
    echo "✅ Nothing to do — running this with --apply would change nothing"
  else
    echo ""
    echo "to apply, re-run:"
    echo "$0 --tenant $TENANT --display-name '$DISPLAY_NAME' --account-name $ACCOUNT_NAME --identity $IDENTITY $SCOPE_ARGS$REMOVE_EXTRA_ARG --apply"
  fi
  exit 0
fi

if [ -z "$APP_ID" ]; then
  APP_ID=$(az ad app create --display-name "$DISPLAY_NAME" --query appId -o tsv)
  echo "✅ App Registration created, appId=$APP_ID"
fi

if [ -z "$OBJECT_ID" ]; then
  OBJECT_ID=$(az ad sp create --id "$APP_ID" --query id -o tsv)
  echo "✅ Service Principal created, objectId=$OBJECT_ID"
fi

for SCOPE in $MISSING; do
  az role assignment create --assignee-object-id "$OBJECT_ID" --assignee-principal-type ServicePrincipal --role "$ROLE" --scope "$SCOPE" >/dev/null
  echo "✅ assigned '$ROLE' at $SCOPE"
done

if [ "$IDENTITY" = 'holder' ] && [ "$PERMISSION_REQUESTED" -eq 0 ]; then
  az ad app permission add --id "$APP_ID" --api "$GRAPH_APP_ID" --api-permissions "$GRAPH_ROLE_ID=Role" >/dev/null
  echo "✅ requested Microsoft Graph '$GRAPH_PERMISSION' on the app registration"
fi

if [ "$REMOVE_EXTRA" -eq 1 ] && [ -n "$EXTRA" ]; then
  printf '%s\n' "$EXTRA" | while IFS="$(printf '\t')" read -r A_ID A_ROLE A_SCOPE; do
    az role assignment delete --ids "$A_ID" >/dev/null
    echo "✅ removed '$A_ROLE' at $A_SCOPE"
  done
fi

echo "✅ Service principal in place, no credential yet"
echo "appId:     $APP_ID"
echo "tenantId:  $TENANT"
echo "Merge this into sdk-config.json (it only fills the $IDENTITY identity — the other one is configured separately):"
jq -n --arg account "$ACCOUNT_NAME" --arg tenantId "$TENANT" --arg identity "$IDENTITY" --arg clientId "$APP_ID" '{az: {accounts: {($account): {tenantId: $tenantId, ($identity): {type: "cert", clientId: $clientId}}}}}'
echo "Then generate and store its certificate: az-keychain-cert-create.sh --tenant $TENANT --display-name '$DISPLAY_NAME' --account-name $ACCOUNT_NAME --identity $IDENTITY --apply"
