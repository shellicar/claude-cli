import type { MemoryEnvironment } from './types';

/**
 * Derive environment keys from a git remote URL. Recognises GitHub and Azure
 * DevOps, HTTPS and SSH. An unrecognised URL yields {} — it labels what it can,
 * never guesses. Keys: org, repo (both hosts) and project (Azure).
 */
export function parseGitRemote(url: string): MemoryEnvironment {
  const trimmed = url.trim().replace(/\.git$/, '');
  if (trimmed === '') {
    return {};
  }

  // GitHub: https://github.com/org/repo  or  git@github.com:org/repo
  const gh = trimmed.match(/github\.com[/:]([^/]+)\/([^/]+)$/);
  if (gh) {
    return { host: 'github', org: gh[1], repo: gh[2] };
  }

  // Azure SSH: git@ssh.dev.azure.com:v3/org/project/repo
  const azureSsh = trimmed.match(/dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (azureSsh) {
    return { host: 'azure', org: azureSsh[1], project: azureSsh[2], repo: azureSsh[3] };
  }

  // Azure HTTPS: https://[org@]dev.azure.com/org/project/_git/repo
  const azureHttps = trimmed.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)$/);
  if (azureHttps) {
    return { host: 'azure', org: azureHttps[1], project: azureHttps[2], repo: azureHttps[3] };
  }

  return {};
}
