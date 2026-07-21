import { computeDelta, formatDelta } from './gitDelta.js';
import { type GitSnapshot, type HeadDivergence, gatherGitSnapshot, gatherHeadDivergence } from './gitSnapshot.js';

export type SnapshotFn = () => Promise<GitSnapshot>;
export type DivergenceFn = (from: string, to: string) => Promise<HeadDivergence | null>;

/**
 * Tracks git state between turns so the agent sees what changed, not just what is.
 *
 * Call `getDelta()` before `runAgent()` — diffs human activity since the last snapshot.
 * Call `takeSnapshot()` after `runAgent()` — captures post-agent state as the new baseline.
 *
 * `getDelta()` returns undefined if no baseline exists yet (first turn, nothing to compare against).
 * Separating the two calls ensures the agent's own file edits and commits are excluded
 * from the delta reported to the next turn.
 */
export class GitStateMonitor {
  #previous: GitSnapshot | null = null;
  readonly #takeSnapshot: SnapshotFn;
  readonly #getDivergence: DivergenceFn;

  public constructor(takeSnapshot: SnapshotFn = gatherGitSnapshot, getDivergence: DivergenceFn = gatherHeadDivergence) {
    this.#takeSnapshot = takeSnapshot;
    this.#getDivergence = getDivergence;
  }

  public async getDelta(): Promise<string | undefined> {
    if (this.#previous === null) {
      return undefined;
    }

    const current = await this.#takeSnapshot();
    const delta = computeDelta(this.#previous, current);
    if (!delta) {
      return undefined;
    }

    // A repo/worktree move makes old and new HEAD unrelated commits; the counts from a cross-repo
    // rev-list would be meaningless, so only look up divergence when the repo root didn't change.
    if (delta.head && !delta.repo) {
      const divergence = await this.#getDivergence(delta.head.from, delta.head.to);
      if (divergence) {
        delta.headDivergence = divergence;
      }
    }

    return formatDelta(delta);
  }

  public async takeSnapshot(): Promise<void> {
    this.#previous = await this.#takeSnapshot();
  }
}
