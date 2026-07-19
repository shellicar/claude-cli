#!/bin/sh
# Creates a project-scoped Azure DevOps security group that can push commits but cannot
# contribute to pull requests, and adds one member to it. Applies to every repo in the project
# (token `repoV2/<projectId>`, no repo suffix) rather than one repo at a time or a broad built-in
# group like Contributors (which also grants work items, builds, etc.).
#
# This is the reader identity's shape (code read/write, PR read-only), not the holder's — the
# holder identity belongs in the built-in Contributors group instead (code + PR + work items
# read/write), which needs no custom group at all: `az devops security group membership add
# --group-id <Contributors descriptor> --member-id <holder descriptor>`.
#
# Must run as an identity with security-admin rights on the project (e.g. your own account, `az
# login` first) — a reader or holder service principal will fail with Access Denied on the
# Identity namespace, by design; managing groups is not something either should be able to do.
#
# Git Repositories security namespace id (2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87) is a fixed,
# built-in Azure DevOps namespace, not something this script creates or looks up.
# Bit 4 = Contribute (push commits). Bit 16384 = Contribute to pull requests.
#
# Dry run by default: prints the plan, touches nothing. Pass --apply to actually create.
#
# Usage:
#   .claude/scripts/ado-push-group-create.sh --org https://dev.azure.com/shellicar/ --project shellicar --name "Reader Push (no PR)" --member <descriptor-or-email>
#   .claude/scripts/ado-push-group-create.sh --org https://dev.azure.com/shellicar/ --project shellicar --name "Reader Push (no PR)" --member <descriptor-or-email> --apply

set -eu

GIT_NAMESPACE_ID='2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87'
CONTRIBUTE_BIT=4
CONTRIBUTE_TO_PR_BIT=16384

ORG=''
PROJECT=''
NAME=''
MEMBER=''
APPLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --org) ORG="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --member) MEMBER="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$ORG" ] || [ -z "$PROJECT" ] || [ -z "$NAME" ] || [ -z "$MEMBER" ]; then
  echo "usage: ado-push-group-create.sh --org ORG --project PROJECT --name NAME --member DESCRIPTOR_OR_EMAIL [--apply]" >&2
  exit 1
fi

echo "plan: az devops security group create --name '$NAME' --project '$PROJECT' --scope project --org '$ORG'"
echo "plan: az devops security permission update --id $GIT_NAMESPACE_ID --subject <new-group-descriptor> --token repoV2/<project-id> --allow-bit $CONTRIBUTE_BIT --deny-bit $CONTRIBUTE_TO_PR_BIT --org '$ORG'"
echo "plan: az devops security group membership add --group-id <new-group-descriptor> --member-id '$MEMBER' --org '$ORG'"

if [ "$APPLY" -eq 0 ]; then
  echo "dry run only — pass --apply to create"
  exit 0
fi

PROJECT_ID=$(az devops project show --project "$PROJECT" --org "$ORG" --query id -o tsv)

if az devops security group list --project "$PROJECT" --org "$ORG" --query "graphGroups[?displayName=='$NAME']" -o tsv | grep -q .; then
  echo "error: a group named '$NAME' already exists in project '$PROJECT' — this script always creates a new one, it does not update an existing group" >&2
  exit 1
fi

GROUP_DESCRIPTOR=$(az devops security group create --name "$NAME" --project "$PROJECT" --scope project --org "$ORG" --query descriptor -o tsv)

az devops security permission update --id "$GIT_NAMESPACE_ID" --subject "$GROUP_DESCRIPTOR" --token "repoV2/$PROJECT_ID" --allow-bit "$CONTRIBUTE_BIT" --deny-bit "$CONTRIBUTE_TO_PR_BIT" --org "$ORG" >/dev/null

az devops security group membership add --group-id "$GROUP_DESCRIPTOR" --member-id "$MEMBER" --org "$ORG" >/dev/null

echo "✓ Group created: $GROUP_DESCRIPTOR"
echo "✓ Project-wide Git permission set: Contribute=Allow, Contribute to pull requests=Deny"
echo "✓ Member added: $MEMBER"
