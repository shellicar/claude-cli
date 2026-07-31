#!/bin/sh
# Creates or updates the custom "Contributor (No Delete)" role definition — Contributor's own
# actions and notActions plus a wildcard */delete NotAction — and sets the scopes it is
# assignable at.
#
# Its own script, separate from az-sp-create.sh, because a role definition is a single
# tenant-level object shared by every service principal ever assigned it, while an SP is created
# once and a certificate rotates repeatedly. Three lifecycles, three scripts. The role also
# outlives any individual SP: adding a scope years later must not mean touching an SP at all.
#
# The role name is not an argument. There is exactly one custom role in this scheme, and a
# free-text name would only make it possible to create a second one by typo, then assign it and
# wonder why the permissions differ.
#
# Idempotent. Run it as often as you like: an absent role is created, an existing one has its
# assignableScopes updated in place, and its actions/notActions are carried through untouched
# rather than rewritten from this script's idea of them.
#
# --scope is repeatable and describes the desired state. By default the script is additive: it
# adds scopes that are missing and reports — but does not remove — scopes present on the role
# that you did not pass. --remove-extra opts in to removing them. Azure refuses to remove a scope
# that still has live role assignments beneath it, so a prune with assignments outstanding fails
# at the az call rather than silently orphaning them.
#
# A scope is a subscription, a resource group, or a management group
# (/providers/Microsoft.Management/managementGroups/<id>). A management group scope is inherited
# by every subscription beneath it, including ones created later.
#
# --tenant is required and pins every az call to that Entra tenant, in an AZURE_CONFIG_DIR
# isolated from the operator's real ~/.azure. See lib/az-session.sh for how the session is
# derived and reused.
#
# Dry run by default: prints the plan, touches nothing. Pass --apply to actually create or update.
#
# Usage:
#   .claude/scripts/az-role-create.sh --tenant <tenant-id> --scope /providers/Microsoft.Management/managementGroups/alz
#   .claude/scripts/az-role-create.sh --tenant <tenant-id> --scope /providers/Microsoft.Management/managementGroups/alz --scope /subscriptions/<id> --apply
#   .claude/scripts/az-role-create.sh --tenant <tenant-id> --scope /providers/Microsoft.Management/managementGroups/alz --remove-extra --apply

set -eu

ROLE_NAME='Contributor (No Delete)'
TENANT=''
SCOPES=''
SCOPE_ARGS=''
APPLY=0
REMOVE_EXTRA=0
REMOVE_EXTRA_ARG=''
ROLE_JSON=''

while [ $# -gt 0 ]; do
  case "$1" in
    --tenant | --scope)
      if [ $# -lt 2 ]; then
        echo "error: $1 requires a value" >&2
        exit 1
      fi
      ;;
  esac

  case "$1" in
    --tenant) TENANT="$2"; shift 2 ;;
    --scope) SCOPES="${SCOPES:+$SCOPES }$2"; SCOPE_ARGS="${SCOPE_ARGS:+$SCOPE_ARGS }--scope $2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --remove-extra) REMOVE_EXTRA=1; REMOVE_EXTRA_ARG=' --remove-extra'; shift ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$TENANT" ] || [ -z "$SCOPES" ]; then
  echo "usage: az-role-create.sh --tenant TENANT --scope SCOPE [--scope SCOPE ...] [--remove-extra] [--apply]" >&2
  exit 1
fi

cleanup() {
  if [ -n "$ROLE_JSON" ]; then
    rm -f "$ROLE_JSON"
  fi
}
trap cleanup EXIT

# Read-only calls happen below regardless of --apply, so the session is established
# unconditionally: a dry run must report against the actual target tenant, not whatever the
# ambient session defaults to.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/lib/az-session.sh"
az_session_begin "$TENANT"

# Word splitting on $SCOPES is deliberate throughout: these are jq positional arguments and az
# list arguments, and an Azure resource ID can contain neither a space nor a newline.
#
# A role definition is one object with one assignableScopes list, so whether it exists is a
# property of the role rather than of any one scope — looked up once, at the first scope given.
FIRST_SCOPE=${SCOPES%% *}

EXISTING=$(az role definition list --name "$ROLE_NAME" --scope "$FIRST_SCOPE" --custom-role-only true --output json)

if [ "$(printf '%s' "$EXISTING" | jq 'length')" -eq 0 ]; then
  if [ "$APPLY" -eq 0 ]; then
    echo "⚡ create custom role '$ROLE_NAME' assignable at:"
    for SCOPE in $SCOPES; do
      echo "   $SCOPE"
    done
    echo ""
    echo "to apply, re-run:"
    echo "$0 --tenant $TENANT $SCOPE_ARGS$REMOVE_EXTRA_ARG --apply"
    exit 0
  fi

  ROLE_JSON=$(mktemp)
  jq -n --arg name "$ROLE_NAME" --args '{Name: $name, IsCustom: true, Description: "Contributor without delete permissions across resource providers.", Actions: ["*"], NotActions: ["Microsoft.Authorization/*/Delete", "Microsoft.Authorization/*/Write", "Microsoft.Authorization/elevateAccess/Action", "Microsoft.Blueprint/blueprintAssignments/write", "Microsoft.Blueprint/blueprintAssignments/delete", "Microsoft.Compute/galleries/share/action", "Microsoft.Purview/consents/write", "Microsoft.Purview/consents/delete", "Microsoft.Resources/deploymentStacks/manageDenySetting/action", "Microsoft.Subscription/cancel/action", "Microsoft.Subscription/enable/action", "*/delete"], DataActions: [], NotDataActions: [], AssignableScopes: $ARGS.positional}' -- $SCOPES > "$ROLE_JSON"
  az role definition create --role-definition "$ROLE_JSON" >/dev/null

  echo "✅ Custom role '$ROLE_NAME' created"
  exit 0
fi

MISSING=$(printf '%s' "$EXISTING" | jq -r --args '($ARGS.positional - .[0].assignableScopes)[]' -- $SCOPES)
EXTRA=$(printf '%s' "$EXISTING" | jq -r --args '(.[0].assignableScopes - $ARGS.positional)[]' -- $SCOPES)

echo "✅ custom role '$ROLE_NAME' exists"

PENDING=0

if [ -n "$MISSING" ]; then
  PENDING=$((PENDING + $(printf '%s\n' "$MISSING" | grep -c .)))
fi
if [ -n "$EXTRA" ] && [ "$REMOVE_EXTRA" -eq 1 ]; then
  PENDING=$((PENDING + $(printf '%s\n' "$EXTRA" | grep -c .)))
fi

if [ -z "$MISSING" ]; then
  echo "✅ every scope you passed is already assignable"
elif [ "$APPLY" -eq 0 ]; then
  echo "⚡ add these scopes to assignableScopes:"
  printf '   %s\n' $MISSING
fi

if [ -z "$EXTRA" ]; then
  echo "✅ no scopes present outside the ones you passed"
elif [ "$APPLY" -eq 0 ]; then
  if [ "$REMOVE_EXTRA" -eq 1 ]; then
    echo "🗑️  remove these scopes from assignableScopes:"
  else
    echo "⚠️  these scopes are present but you did not pass them — left alone, pass --remove-extra to remove them:"
  fi
  printf '   %s\n' $EXTRA
elif [ "$REMOVE_EXTRA" -eq 0 ]; then
  echo "⚠️  scopes are present that you did not pass — re-run with --remove-extra to remove them"
fi

if [ "$PENDING" -eq 0 ]; then
  echo "✅ Nothing to do — running this with --apply would change nothing"
  exit 0
fi

if [ "$APPLY" -eq 0 ]; then
  echo ""
  echo "to apply, re-run:"
  echo "$0 --tenant $TENANT $SCOPE_ARGS$REMOVE_EXTRA_ARG --apply"
  exit 0
fi

# Built by editing the definition az just returned rather than by reconstructing one: the role's
# actions, notActions and identity are carried through exactly as they are, so this script can
# never quietly rewrite the permission set while only meaning to change a scope.
if [ "$REMOVE_EXTRA" -eq 1 ]; then
  UPDATED=$(printf '%s' "$EXISTING" | jq --args '.[0] | .assignableScopes = $ARGS.positional' -- $SCOPES)
else
  UPDATED=$(printf '%s' "$EXISTING" | jq --args '.[0] | .assignableScopes = (.assignableScopes + $ARGS.positional | unique)' -- $SCOPES)
fi

ROLE_JSON=$(mktemp)
printf '%s' "$UPDATED" > "$ROLE_JSON"
az role definition update --role-definition "$ROLE_JSON" >/dev/null

echo "✅ Custom role '$ROLE_NAME' updated"
