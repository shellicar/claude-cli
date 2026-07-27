import type { AdoRemoteContext } from './parseAdoRemote';

/** Resolution order for `--org`: the model's explicit `org` input wins; otherwise the org parsed
 *  from the target repo's own git remote (see parseAdoRemote). No config-level default — between
 *  remote parsing and the explicit input field, there is always a way to supply it, so a third,
 *  harder-to-discover fallback layer only adds a place for the wrong org to hide. Omitted entirely
 *  when neither source has one, so `az`'s own error names what's actually missing. */
export function orgArgs(org: string | undefined, remote: AdoRemoteContext | null): string[] {
  const resolved = org ?? remote?.orgUrl;
  return resolved != null ? ['--org', resolved] : [];
}
