import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** The `origin` remote URL for the repo at `cwd`, or null if there is no git repo, no such remote,
 *  or git isn't available. Best-effort: callers treat null as "nothing to derive from", not an
 *  error — the model's explicit input and the account's configured default are the real fallbacks. */
export async function getGitRemoteUrl(cwd: string, remote = 'origin'): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', remote], { cwd });
    const url = stdout.trim();
    return url.length > 0 ? url : null;
  } catch {
    return null;
  }
}
