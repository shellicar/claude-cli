# Shared az session setup, sourced by the scripts in the parent directory. Not executable and not
# runnable on its own: it defines one function and is meant to be dotted in.
#
# Every one of these scripts must act on the tenant it was told to act on, never on whatever the
# operator's ambient `az login` session happens to default to. An operator who is a guest across
# several tenants otherwise gets silent wrong-directory failures: an app looked up in the wrong
# tenant is simply not found, and a role definition created there looks like success.
#
# So each script gets its own AZURE_CONFIG_DIR, isolated from the real ~/.azure. The directory is
# derived from the tenant id rather than being a fresh mktemp per run, which means a dry run and
# the --apply that follows it share one session and cost one login between them instead of two.
# It also means the reader and holder runs for the same tenant share a session, while different
# tenants never do.
#
# It lives under $TMPDIR so the OS reclaims it: the MSAL token cache inside is plaintext on macOS
# and Linux, per Microsoft's own docs, so a session left behind is a credential left behind. The
# cost of that reclamation is an occasional extra login after a reboot or a few days idle, which
# is the right trade for not keeping token caches indefinitely.
#
# The uid is in the path because $TMPDIR is per-user on macOS but usually plain /tmp on Linux and
# WSL, where a fixed shared name is another user's to create first. Owning a uid-scoped parent
# means the directory this script writes into is always its own.

# Sets up AZURE_CONFIG_DIR for the given tenant and logs in only if that session isn't already
# live. Call once, early, before any other az call in the script.
az_session_begin() {
  az_session_tenant="$1"

  # $az_session_tenant becomes a path component, so anything that isn't a GUID is rejected before
  # it is used. Catches a traversal attempt, and more usefully catches passing a tenant domain
  # like 'contoso.com' where an id belongs.
  az_session_hex4='[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'
  az_session_guid="$az_session_hex4$az_session_hex4-$az_session_hex4-$az_session_hex4-$az_session_hex4-$az_session_hex4$az_session_hex4$az_session_hex4"

  case "$az_session_tenant" in
    $az_session_guid) ;;
    *)
      echo "error: --tenant must be a tenant id GUID, got '$az_session_tenant'" >&2
      return 1
      ;;
  esac

  az_session_tmp="${TMPDIR:-/tmp}"
  az_session_root="${az_session_tmp%/}/shellicar-az-$(id -u)"
  AZURE_CONFIG_DIR="$az_session_root/$az_session_tenant"
  export AZURE_CONFIG_DIR

  mkdir -p "$AZURE_CONFIG_DIR"
  chmod 700 "$az_session_root" "$AZURE_CONFIG_DIR"

  # Reusing the session is the whole point of the stable path, so the login is conditional. Any
  # failure here — no session, expired refresh token, a cache the CLI can't read — means log in.
  if az account show >/dev/null 2>&1; then
    echo "session: reusing existing login for tenant $az_session_tenant ($AZURE_CONFIG_DIR)"
    return 0
  fi

  echo "session: az login --tenant $az_session_tenant --allow-no-subscriptions ($AZURE_CONFIG_DIR)"
  az login --tenant "$az_session_tenant" --allow-no-subscriptions >/dev/null
}
