import type { GitSnapshot } from './gitSnapshot.js';

// ---------------------------------------------------------------------------
// DeltaValues — structured diff between two snapshots.
// Only fields that actually changed are present; absent = no change.
// ---------------------------------------------------------------------------

export type DeltaField<T> = { from: T; to: T };

/** Counts of paths added to / removed from a file category between snapshots. */
export type FileDelta = { added: number; removed: number };

export type DeltaValues = {
  branch?: DeltaField<string>;
  head?: DeltaField<string>;
  staged?: FileDelta;
  unstaged?: FileDelta;
  untracked?: FileDelta;
  stashCount?: DeltaField<number>;
};

// ---------------------------------------------------------------------------
// Transform — compares two snapshots, returns null when nothing changed.
// ---------------------------------------------------------------------------

function diffFiles(previous: readonly string[], current: readonly string[]): FileDelta | null {
  const prevSet = new Set(previous);
  const currSet = new Set(current);
  const added = current.filter((f) => !prevSet.has(f)).length;
  const removed = previous.filter((f) => !currSet.has(f)).length;
  if (added === 0 && removed === 0) {
    return null;
  }
  return { added, removed };
}

function formatFileDelta(delta: FileDelta): string {
  const parts: string[] = [];
  if (delta.added > 0) {
    parts.push(`+${delta.added}`);
  }
  if (delta.removed > 0) {
    parts.push(`-${delta.removed}`);
  }
  return `${parts.join(', ')} files`;
}

export function computeDelta(previous: GitSnapshot, current: GitSnapshot): DeltaValues | null {
  const delta: DeltaValues = {};

  if (current.branch !== previous.branch) {
    delta.branch = { from: previous.branch, to: current.branch };
  }
  if (current.head !== previous.head) {
    delta.head = { from: previous.head, to: current.head };
  }
  const stagedDelta = diffFiles(previous.stagedFiles, current.stagedFiles);
  if (stagedDelta) {
    delta.staged = stagedDelta;
  }
  const unstagedDelta = diffFiles(previous.unstagedFiles, current.unstagedFiles);
  if (unstagedDelta) {
    delta.unstaged = unstagedDelta;
  }
  const untrackedDelta = diffFiles(previous.untrackedFiles, current.untrackedFiles);
  if (untrackedDelta) {
    delta.untracked = untrackedDelta;
  }
  if (current.stashCount !== previous.stashCount) {
    delta.stashCount = { from: previous.stashCount, to: current.stashCount };
  }

  if (Object.keys(delta).length === 0) {
    return null;
  }
  return delta;
}

// ---------------------------------------------------------------------------
// Build — turns DeltaValues into the injected text line.
// ---------------------------------------------------------------------------

export function formatDelta(delta: DeltaValues): string {
  const parts: string[] = [];

  if (delta.branch) {
    parts.push(`branch: ${delta.branch.from} \u2192 ${delta.branch.to}`);
  }
  if (delta.head) {
    parts.push(`HEAD: ${delta.head.from} \u2192 ${delta.head.to}`);
  }
  if (delta.staged) {
    parts.push(`staged: ${formatFileDelta(delta.staged)}`);
  }
  if (delta.unstaged) {
    parts.push(`unstaged: ${formatFileDelta(delta.unstaged)}`);
  }
  if (delta.untracked) {
    parts.push(`untracked: ${formatFileDelta(delta.untracked)}`);
  }
  if (delta.stashCount !== undefined) {
    parts.push(`stash: ${delta.stashCount.from}\u2192${delta.stashCount.to}`);
  }

  return `[git delta] ${parts.join(' | ')}`;
}
