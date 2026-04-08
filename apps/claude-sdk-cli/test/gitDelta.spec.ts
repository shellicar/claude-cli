import { describe, expect, it } from 'vitest';
import { GitStateMonitor } from '../src/GitStateMonitor.js';
import { computeDelta, type DeltaValues, type FileDelta, formatDelta } from '../src/gitDelta.js';
import type { GitSnapshot } from '../src/gitSnapshot.js';

const base: GitSnapshot = {
  branch: 'main',
  head: 'abc1234',
  stagedFiles: [],
  unstagedFiles: [],
  untrackedFiles: [],
  stashCount: 0,
};

// ---------------------------------------------------------------------------
// computeDelta — identical snapshots
// ---------------------------------------------------------------------------

describe('computeDelta — no changes', () => {
  it('returns null when both snapshots are identical', () => {
    const actual = computeDelta(base, { ...base });
    const expected = null;
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// computeDelta — individual field changes
// ---------------------------------------------------------------------------

describe('computeDelta — branch change', () => {
  it('captures branch from/to when branch differs', () => {
    const current = { ...base, branch: 'feature/x' };
    const actual = computeDelta(base, current);
    const expected: DeltaValues = { branch: { from: 'main', to: 'feature/x' } };
    expect(actual).toEqual(expected);
  });
});

describe('computeDelta — HEAD change', () => {
  it('captures head from/to when HEAD differs', () => {
    const current = { ...base, head: 'def5678' };
    const actual = computeDelta(base, current);
    const expected: DeltaValues = { head: { from: 'abc1234', to: 'def5678' } };
    expect(actual).toEqual(expected);
  });
});

describe('computeDelta — staged change', () => {
  it('detects new files added to staging area', () => {
    const current = { ...base, stagedFiles: ['src/foo.ts', 'src/bar.ts'] };
    const actual = computeDelta(base, current);
    const expected: DeltaValues = { staged: { added: 2, removed: 0 } };
    expect(actual).toEqual(expected);
  });

  it('detects files removed from staging area', () => {
    const previous = { ...base, stagedFiles: ['src/foo.ts'] };
    const current = { ...base, stagedFiles: [] };
    const actual = computeDelta(previous, current);
    const expected: DeltaValues = { staged: { added: 0, removed: 1 } };
    expect(actual).toEqual(expected);
  });

  it('detects swap — same count but different files', () => {
    const previous = { ...base, stagedFiles: ['src/foo.ts'] };
    const current = { ...base, stagedFiles: ['src/bar.ts'] };
    const actual = computeDelta(previous, current);
    const expected: DeltaValues = { staged: { added: 1, removed: 1 } };
    expect(actual).toEqual(expected);
  });

  it('returns null when staged files are identical', () => {
    const previous = { ...base, stagedFiles: ['src/foo.ts'] };
    const current = { ...base, stagedFiles: ['src/foo.ts'] };
    const actual = computeDelta(previous, current);
    const expected = null;
    expect(actual).toEqual(expected);
  });
});

describe('computeDelta — unstaged change', () => {
  it('detects new unstaged modifications', () => {
    const current = { ...base, unstagedFiles: ['src/foo.ts'] };
    const actual = computeDelta(base, current);
    const expected: DeltaValues = { unstaged: { added: 1, removed: 0 } };
    expect(actual).toEqual(expected);
  });
});

describe('computeDelta — untracked change', () => {
  it('detects new untracked files', () => {
    const current = { ...base, untrackedFiles: ['src/new.ts'] };
    const actual = computeDelta(base, current);
    const expected: DeltaValues = { untracked: { added: 1, removed: 0 } };
    expect(actual).toEqual(expected);
  });
});

describe('computeDelta — stash change', () => {
  it('captures stashCount from/to when stash count differs', () => {
    const current = { ...base, stashCount: 1 };
    const actual = computeDelta(base, current);
    const expected: DeltaValues = { stashCount: { from: 0, to: 1 } };
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// computeDelta — multiple fields
// ---------------------------------------------------------------------------

describe('computeDelta — multiple changes', () => {
  it('captures all changed fields and omits unchanged ones', () => {
    const current = { ...base, branch: 'fix/y', head: 'def5678', stagedFiles: ['src/a.ts', 'src/b.ts'] };
    const actual = computeDelta(base, current);
    const expected: DeltaValues = {
      branch: { from: 'main', to: 'fix/y' },
      head: { from: 'abc1234', to: 'def5678' },
      staged: { added: 2, removed: 0 },
    };
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// formatDelta
// ---------------------------------------------------------------------------

describe('formatDelta — prefix', () => {
  it('starts with [git delta]', () => {
    const actual = formatDelta({ branch: { from: 'main', to: 'feature/x' } });
    const expected = true;
    expect(actual.startsWith('[git delta]')).toEqual(expected);
  });
});

describe('formatDelta — branch', () => {
  it('formats branch change with arrow', () => {
    const actual = formatDelta({ branch: { from: 'main', to: 'feature/x' } });
    const expected = '[git delta] branch: main \u2192 feature/x';
    expect(actual).toEqual(expected);
  });
});

describe('formatDelta — HEAD', () => {
  it('formats HEAD change with arrow', () => {
    const actual = formatDelta({ head: { from: 'abc1234', to: 'def5678' } });
    const expected = '[git delta] HEAD: abc1234 \u2192 def5678';
    expect(actual).toEqual(expected);
  });
});

describe('formatDelta — file counts', () => {
  it('formats files added to staging', () => {
    const delta: FileDelta = { added: 3, removed: 0 };
    const actual = formatDelta({ staged: delta });
    const expected = '[git delta] staged: +3 files';
    expect(actual).toEqual(expected);
  });

  it('formats files removed from staging', () => {
    const delta: FileDelta = { added: 0, removed: 2 };
    const actual = formatDelta({ staged: delta });
    const expected = '[git delta] staged: -2 files';
    expect(actual).toEqual(expected);
  });

  it('formats both added and removed files in staging (the swap case)', () => {
    const delta: FileDelta = { added: 2, removed: 2 };
    const actual = formatDelta({ staged: delta });
    const expected = '[git delta] staged: +2, -2 files';
    expect(actual).toEqual(expected);
  });

  it('formats unstaged change', () => {
    const delta: FileDelta = { added: 1, removed: 0 };
    const actual = formatDelta({ unstaged: delta });
    const expected = '[git delta] unstaged: +1 files';
    expect(actual).toEqual(expected);
  });

  it('formats stash change', () => {
    const actual = formatDelta({ stashCount: { from: 0, to: 2 } });
    const expected = '[git delta] stash: 0\u21922';
    expect(actual).toEqual(expected);
  });
});

describe('formatDelta — multiple fields joined with pipe', () => {
  it('joins multiple fields with space-pipe-space', () => {
    const actual = formatDelta({
      branch: { from: 'main', to: 'fix/y' },
      head: { from: 'abc1234', to: 'def5678' },
    });
    const expected = '[git delta] branch: main \u2192 fix/y | HEAD: abc1234 \u2192 def5678';
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// GitStateMonitor
// ---------------------------------------------------------------------------

describe('GitStateMonitor — first call', () => {
  it('returns null on the first call (no baseline yet)', async () => {
    const monitor = new GitStateMonitor(() => Promise.resolve({ ...base }));
    const actual = await monitor.takeDelta();
    const expected = null;
    expect(actual).toEqual(expected);
  });
});

describe('GitStateMonitor — no change between calls', () => {
  it('returns null when snapshot is identical to baseline', async () => {
    const monitor = new GitStateMonitor(() => Promise.resolve({ ...base }));
    await monitor.takeDelta(); // establish baseline
    const actual = await monitor.takeDelta();
    const expected = null;
    expect(actual).toEqual(expected);
  });
});

describe('GitStateMonitor — change between calls', () => {
  it('returns formatted delta string when branch changes', async () => {
    let call = 0;
    const snapshots: GitSnapshot[] = [base, { ...base, branch: 'feature/x' }];
    const monitor = new GitStateMonitor(() => Promise.resolve({ ...(snapshots[call++] ?? base) }));
    await monitor.takeDelta(); // baseline
    const actual = await monitor.takeDelta();
    const expected = '[git delta] branch: main \u2192 feature/x';
    expect(actual).toEqual(expected);
  });

  it('advances the baseline so next call diffs against the most recent snapshot', async () => {
    let call = 0;
    const snapshots: GitSnapshot[] = [base, { ...base, branch: 'feature/x' }, { ...base, branch: 'feature/x' }];
    const monitor = new GitStateMonitor(() => Promise.resolve({ ...(snapshots[call++] ?? base) }));
    await monitor.takeDelta(); // baseline: main
    await monitor.takeDelta(); // delta: main → feature/x
    const actual = await monitor.takeDelta(); // no change: feature/x → feature/x
    const expected = null;
    expect(actual).toEqual(expected);
  });
});
