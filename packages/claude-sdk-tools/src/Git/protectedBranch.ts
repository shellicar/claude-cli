import type { GitDeps } from './runGit';
import { runGit } from './runGit';

/** The repo's actual default branch, resolved from the remote's own HEAD pointer — not the
 *  currently checked-out branch, which can legitimately BE the default branch for a moment (e.g.
 *  right after a pull, before creating a feature branch) without anything dangerous being
 *  attempted. "Protected" is a property of the branch name a target resolves to, not of where HEAD
 *  happens to be sitting right now. Returns null when it can't be determined (no origin remote, a
 *  repo with no such pointer set) — the guard fails open in that case rather than blocking normal
 *  use of a repo with nothing configured to protect. */
export async function resolveDefaultBranch(deps: GitDeps, cwd: string): Promise<string | null> {
  const result = await runGit(deps, ['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd);
  if (result.exitCode !== 0) {
    return null;
  }
  const ref = result.stdout.trim();
  const prefix = 'refs/remotes/origin/';
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : null;
}

async function resolveCurrentBranch(deps: GitDeps, cwd: string): Promise<string | null> {
  const result = await runGit(deps, ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  if (result.exitCode !== 0) {
    return null;
  }
  const branch = result.stdout.trim();
  return branch === 'HEAD' ? null : branch; // detached HEAD — nothing named to protect
}

/** A `branch` field on a push-shaped tool isn't necessarily a bare name — git push accepts a full
 *  refspec, `<src>:<dst>` (optionally force-prefixed with `+`), and `assertNotDefaultBranch` must
 *  compare against the actual destination, not the raw field: `'HEAD:main'` and `'refs/heads/main'`
 *  both name the default branch just as much as a bare `'main'` does. */
function normaliseTarget(target: string): string {
  const destination = target.includes(':') ? target.slice(target.lastIndexOf(':') + 1) : target;
  const unforced = destination.startsWith('+') ? destination.slice(1) : destination;
  const prefix = 'refs/heads/';
  return unforced.startsWith(prefix) ? unforced.slice(prefix.length) : unforced;
}

/** Refuses when `targetBranch` (or, if null, the currently checked-out branch) resolves to the
 *  repo's default branch. The reflog-recoverability that makes a reflog-tier operation acceptable
 *  only holds for local, personal history — the moment the target is a branch other clones depend
 *  on, a collaborator who already pulled the old tip has no reflog entry pointing back to it once
 *  their own branch moves past it. That is a different, much larger blast radius than the same
 *  operation on a feature branch, and it is what this guard exists to catch. */
export async function assertNotDefaultBranch(deps: GitDeps, cwd: string, targetBranch: string | null, toolName: string): Promise<void> {
  const defaultBranch = await resolveDefaultBranch(deps, cwd);
  if (defaultBranch == null) {
    return;
  }
  const branch = targetBranch != null ? normaliseTarget(targetBranch) : await resolveCurrentBranch(deps, cwd);
  if (branch === defaultBranch) {
    throw new Error(`${toolName} refused: '${branch}' is this repo's default branch (origin/HEAD). Rewriting it can strand other clones with no local recovery of their own. Disable protectDefaultBranch to override.`);
  }
}
