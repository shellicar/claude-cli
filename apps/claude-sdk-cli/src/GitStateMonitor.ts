import { computeDelta, formatDelta } from './gitDelta.js';
import { type GitSnapshot, gatherGitSnapshot } from './gitSnapshot.js';

export type SnapshotFn = () => Promise<GitSnapshot>;

/**
 * Tracks git state between turns so the agent sees what changed, not just what is.
 *
 * Call `getDelta()` before `runAgent()` — diffs human activity since the last snapshot.
 * Call `takeSnapshot()` after `runAgent()` — captures post-agent state as the new baseline.
 *
 * `getDelta()` returns null if no baseline exists yet (first turn, nothing to compare against).
 * Separating the two calls ensures the agent's own file edits and commits are excluded
 * from the delta reported to the next turn.
 */
export class GitStateMonitor {
  #previous: GitSnapshot | null = null;
  readonly #takeSnapshot: SnapshotFn;

  public constructor(takeSnapshot: SnapshotFn = gatherGitSnapshot) {
    this.#takeSnapshot = takeSnapshot;
  }

  public async getDelta(): Promise<string | undefined> {
    if (this.#previous === null) {
      return undefined;
    }

    const current = await this.#takeSnapshot();
    const delta = computeDelta(this.#previous, current);

    return delta ? formatDelta(delta) : undefined;
  }

  public async takeSnapshot(): Promise<void> {
    this.#previous = await this.#takeSnapshot();
  }
}
