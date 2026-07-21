/** Keys git itself uses to carry a live, working credential rather than a preference — CI runners
 *  (GitHub Actions especially) commonly write `http.<url>.extraheader` with a bearer/basic auth
 *  header directly into the repo's local config to authenticate git operations. Reading these back
 *  verbatim would hand that credential to whoever reads the tool's output. The key and the fact a
 *  value exists stay visible (that's the actual diagnostic fact — "header auth is configured"); the
 *  value itself does not. */
const CREDENTIAL_KEY_PATTERNS = [/^http\..*\.extraheader$/i, /^http\.extraheader$/i, /credential\./i, /^http\.proxy$/i];

function isCredentialKey(key: string): boolean {
  return CREDENTIAL_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/** `scheme://user:token@host/...` is a normal way git remotes and credential managers carry a
 *  working credential inline in the URL. Masks just the userinfo portion — the host and path stay
 *  visible, since that's the part actually useful for diagnosing "which remote/host is this going
 *  to", not the secret riding along with it. */
export function redactUserinfo(text: string): string {
  return text.replace(/(:\/\/)([^\s/@]+)@/g, '$1***@');
}

/** For a single `git config --get <key>` lookup, the key is already known from the input — redact
 *  the whole value outright for a credential-bearing key, otherwise just mask embedded userinfo. */
export function redactConfigValue(key: string, value: string): string {
  if (isCredentialKey(key)) {
    return '***REDACTED***';
  }
  return redactUserinfo(value);
}

/** `git config --list` output is `key=value` per line (no spaces), one pair per line. Applies the
 *  same per-key redaction as `redactConfigValue` across every line, not just a value the caller
 *  named up front. */
export function redactConfigListOutput(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const eq = line.indexOf('=');
      if (eq === -1) {
        return line;
      }
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1);
      return `${key}=${redactConfigValue(key, value)}`;
    })
    .join('\n');
}
