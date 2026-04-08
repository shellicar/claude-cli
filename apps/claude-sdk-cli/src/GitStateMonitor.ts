import { computeDelta, formatDelta } from './gitDelta.js';
import { type GitSnapshot, gatherGitSnapshot } from './gitSnapshot.js';

export type SnapshotFn = () => Promise<GitSnapshot>;

/**
 * Tracks git state between turns so the agent sees what changed, not just what is.
 *
 * First call: stores the baseline, returns null (no stale model yet, nothing to inject).
 * Subsequent calls: computes delta against the stored baseline, updates it, returns
 * the formatted delta string or null if nothing changed (silence = signal).
 */
export class GitStateMonitor {
  #previous: GitSnapshot | null = null;
  readonly #takeSnapshot: SnapshotFn;

  public constructor(takeSnapshot: SnapshotFn = gatherGitSnapshot) {
    this.#takeSnapshot = takeSnapshot;
  }

  public async takeDelta(): Promise<string | null> {
    const current = await this.#takeSnapshot();

    if (this.#previous === null) {
      this.#previous = current;
      return null;
    }

    const delta = computeDelta(this.#previous, current);
    this.#previous = current;

    return delta ? formatDelta(delta) : null;
  }
}
