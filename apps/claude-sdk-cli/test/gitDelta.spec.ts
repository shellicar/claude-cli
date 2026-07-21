import { describe, expect, it } from 'vitest';
import { GitStateMonitor } from '../src/GitStateMonitor.js';
import { computeDelta, type DeltaValues, type FileDelta, formatDelta, formatHeadDivergence } from '../src/gitDelta.js';
import type { GitSnapshot } from '../src/gitSnapshot.js';

const base: GitSnapshot = {
  root: '/repo/one',
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

describe('computeDelta — repo change', () => {
  it('captures repo root from/to when the working directory moves into another repo', () => {
    const current = { ...base, root: '/repo/two' };
    const actual = computeDelta(base, current);
    const expected: DeltaValues = { repo: { from: '/repo/one', to: '/repo/two' } };
    expect(actual).toEqual(expected);
  });
});

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

describe('formatDelta — wrapper', () => {
  it('wraps the delta in a <git-delta> tag', () => {
    const actual = formatDelta({ branch: { from: 'main', to: 'feature/x' } });
    const expected = true;
    expect(actual.startsWith('<git-delta>') && actual.endsWith('</git-delta>')).toEqual(expected);
  });
});

describe('formatDelta — repo', () => {
  it('formats repo root change with arrow', () => {
    const actual = formatDelta({ repo: { from: '/repo/one', to: '/repo/two' } });
    const expected = '<git-delta>repo: /repo/one → /repo/two</git-delta>';
    expect(actual).toEqual(expected);
  });

  it('shows (none) when moving out of or into a non-repo directory', () => {
    const actual = formatDelta({ repo: { from: '/repo/one', to: '' } });
    const expected = '<git-delta>repo: /repo/one → (none)</git-delta>';
    expect(actual).toEqual(expected);
  });
});

describe('formatDelta — branch', () => {
  it('formats branch change with arrow', () => {
    const actual = formatDelta({ branch: { from: 'main', to: 'feature/x' } });
    const expected = '<git-delta>branch: main \u2192 feature/x</git-delta>';
    expect(actual).toEqual(expected);
  });
});

describe('formatDelta — HEAD', () => {
  it('formats HEAD change with arrow', () => {
    const actual = formatDelta({ head: { from: 'abc1234', to: 'def5678' } });
    const expected = '<git-delta>HEAD: abc1234 \u2192 def5678</git-delta>';
    expect(actual).toEqual(expected);
  });
});

describe('formatDelta — file counts', () => {
  it('formats files added to staging', () => {
    const delta: FileDelta = { added: 3, removed: 0 };
    const actual = formatDelta({ staged: delta });
    const expected = '<git-delta>staged: +3 files</git-delta>';
    expect(actual).toEqual(expected);
  });

  it('formats files removed from staging', () => {
    const delta: FileDelta = { added: 0, removed: 2 };
    const actual = formatDelta({ staged: delta });
    const expected = '<git-delta>staged: -2 files</git-delta>';
    expect(actual).toEqual(expected);
  });

  it('formats both added and removed files in staging (the swap case)', () => {
    const delta: FileDelta = { added: 2, removed: 2 };
    const actual = formatDelta({ staged: delta });
    const expected = '<git-delta>staged: +2, -2 files</git-delta>';
    expect(actual).toEqual(expected);
  });

  it('formats unstaged change', () => {
    const delta: FileDelta = { added: 1, removed: 0 };
    const actual = formatDelta({ unstaged: delta });
    const expected = '<git-delta>unstaged: +1 files</git-delta>';
    expect(actual).toEqual(expected);
  });

  it('formats stash change', () => {
    const actual = formatDelta({ stashCount: { from: 0, to: 2 } });
    const expected = '<git-delta>stash: 0\u21922</git-delta>';
    expect(actual).toEqual(expected);
  });
});

describe('formatHeadDivergence', () => {
  it('shows only ahead when nothing is behind', () => {
    const actual = formatHeadDivergence({ onlyOld: 0, onlyNew: 21 });
    const expected = '21 ahead';
    expect(actual).toEqual(expected);
  });

  it('shows only behind when nothing is ahead', () => {
    const actual = formatHeadDivergence({ onlyOld: 10, onlyNew: 0 });
    const expected = '10 behind';
    expect(actual).toEqual(expected);
  });

  it('shows both counts when commits sit on each side', () => {
    const actual = formatHeadDivergence({ onlyOld: 10, onlyNew: 21 });
    const expected = '10 behind, 21 ahead';
    expect(actual).toEqual(expected);
  });
});

describe('formatDelta — HEAD with divergence', () => {
  it('appends the divergence description after the arrow', () => {
    const actual = formatDelta({
      head: { from: '8f9138d', to: '8c59648' },
      headDivergence: { onlyOld: 10, onlyNew: 21 },
    });
    const expected = '<git-delta>HEAD: 8f9138d → 8c59648 (10 behind, 21 ahead)</git-delta>';
    expect(actual).toEqual(expected);
  });
});

describe('formatDelta — multiple fields joined with pipe', () => {
  it('joins multiple fields with space-pipe-space', () => {
    const actual = formatDelta({
      branch: { from: 'main', to: 'fix/y' },
      head: { from: 'abc1234', to: 'def5678' },
    });
    const expected = '<git-delta>branch: main \u2192 fix/y | HEAD: abc1234 \u2192 def5678</git-delta>';
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// GitStateMonitor
// ---------------------------------------------------------------------------

describe('GitStateMonitor — first call', () => {
  it('returns undefined on the first call (no baseline yet)', async () => {
    const monitor = new GitStateMonitor(() => Promise.resolve({ ...base }));
    const actual = await monitor.getDelta();
    expect(actual).toBeUndefined();
  });
});

describe('GitStateMonitor — no change between calls', () => {
  it('returns undefined when snapshot is identical to baseline', async () => {
    const monitor = new GitStateMonitor(() => Promise.resolve({ ...base }));
    await monitor.takeSnapshot(); // establish baseline
    const actual = await monitor.getDelta();
    expect(actual).toBeUndefined();
  });
});

describe('GitStateMonitor — HEAD change queries divergence', () => {
  it('includes the divergence description when HEAD changes', async () => {
    let call = 0;
    const snapshots: GitSnapshot[] = [base, { ...base, head: 'def5678' }];
    const monitor = new GitStateMonitor(
      () => Promise.resolve({ ...(snapshots[call++] ?? base) }),
      (from, to) => {
        expect(from).toEqual('abc1234');
        expect(to).toEqual('def5678');
        return Promise.resolve({ onlyOld: 0, onlyNew: 1 });
      },
    );
    await monitor.takeSnapshot();
    const actual = await monitor.getDelta();
    const expected = '<git-delta>HEAD: abc1234 \u2192 def5678 (1 ahead)</git-delta>';
    expect(actual).toEqual(expected);
  });

  it('omits the divergence description when the divergence lookup fails', async () => {
    let call = 0;
    const snapshots: GitSnapshot[] = [base, { ...base, head: 'def5678' }];
    const monitor = new GitStateMonitor(
      () => Promise.resolve({ ...(snapshots[call++] ?? base) }),
      () => Promise.resolve(null),
    );
    await monitor.takeSnapshot();
    const actual = await monitor.getDelta();
    const expected = '<git-delta>HEAD: abc1234 \u2192 def5678</git-delta>';
    expect(actual).toEqual(expected);
  });

  it('skips the divergence lookup entirely when the move crossed into a different repo', async () => {
    let call = 0;
    const snapshots: GitSnapshot[] = [base, { ...base, root: '/repo/two', head: 'def5678' }];
    let divergenceCalled = false;
    const monitor = new GitStateMonitor(
      () => Promise.resolve({ ...(snapshots[call++] ?? base) }),
      () => {
        divergenceCalled = true;
        return Promise.resolve({ onlyOld: 0, onlyNew: 1 });
      },
    );
    await monitor.takeSnapshot();
    const actual = await monitor.getDelta();
    const expected = '<git-delta>repo: /repo/one \u2192 /repo/two | HEAD: abc1234 \u2192 def5678</git-delta>';
    expect(actual).toEqual(expected);
    expect(divergenceCalled).toEqual(false);
  });
});

describe('GitStateMonitor — change between calls', () => {
  it('returns formatted delta string when branch changes', async () => {
    let call = 0;
    const snapshots: GitSnapshot[] = [base, { ...base, branch: 'feature/x' }];
    const monitor = new GitStateMonitor(() => Promise.resolve({ ...(snapshots[call++] ?? base) }));
    await monitor.takeSnapshot(); // baseline: snapshot[0] = base
    const actual = await monitor.getDelta(); // diffs snapshot[1] against base
    const expected = '<git-delta>branch: main \u2192 feature/x</git-delta>';
    expect(actual).toEqual(expected);
  });

  it('advances the baseline so next call diffs against the most recent snapshot', async () => {
    let call = 0;
    const featureX = { ...base, branch: 'feature/x' };
    const snapshots: GitSnapshot[] = [base, featureX, featureX, featureX];
    const monitor = new GitStateMonitor(() => Promise.resolve({ ...(snapshots[call++] ?? base) }));
    await monitor.takeSnapshot(); // baseline: snapshot[0] = base (main)
    await monitor.getDelta(); // diffs snapshot[1] = feature/x against base — returns delta (not used)
    await monitor.takeSnapshot(); // advance baseline: snapshot[2] = feature/x
    const actual = await monitor.getDelta(); // diffs snapshot[3] = feature/x against feature/x — no change
    expect(actual).toBeUndefined();
  });
});
