export type AdoRemoteContext = {
  orgUrl: string;
  project: string;
  repository: string;
};

/** Azure DevOps git remote URLs carry org, project, and repository together \u2014 `az`'s own
 *  `--detect` only ever resolves organization (its own help text says so explicitly), never
 *  project, so parsing the remote ourselves is what actually closes the gap. Supports the two
 *  live formats (HTTPS, SSH) and the legacy `<org>.visualstudio.com` one. Returns null for
 *  anything else (e.g. a GitHub remote) rather than guessing. */
export function parseAdoRemote(url: string): AdoRemoteContext | null {
  const https = url.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+?)(?:\.git)?\/?$/);
  if (https) {
    return { orgUrl: `https://dev.azure.com/${https[1]}/`, project: decodeURIComponent(https[2]), repository: decodeURIComponent(https[3]) };
  }

  const ssh = url.match(/ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (ssh) {
    return { orgUrl: `https://dev.azure.com/${ssh[1]}/`, project: decodeURIComponent(ssh[2]), repository: decodeURIComponent(ssh[3]) };
  }

  const legacy = url.match(/https:\/\/([^./]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+?)(?:\.git)?\/?$/);
  if (legacy) {
    return { orgUrl: `https://dev.azure.com/${legacy[1]}/`, project: decodeURIComponent(legacy[2]), repository: decodeURIComponent(legacy[3]) };
  }

  return null;
}
