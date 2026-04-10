import { describe, expect, it } from 'vitest';
import { gatherGitSnapshot, parseBranch, parseHead, parseStash, parseStatus } from '../src/gitSnapshot.js';

// ---------------------------------------------------------------------------
// parseBranch
// ---------------------------------------------------------------------------

describe('parseBranch', () => {
  it('returns branch name trimmed of whitespace', () => {
    const actual = parseBranch('main\n');
    const expected = 'main';
    expect(actual).toEqual(expected);
  });

  it('returns empty string for detached HEAD', () => {
    const actual = parseBranch('\n');
    const expected = '';
    expect(actual).toEqual(expected);
  });

  it('preserves slashes in branch names', () => {
    const actual = parseBranch('feature/my-thing\n');
    const expected = 'feature/my-thing';
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// parseHead
// ---------------------------------------------------------------------------

describe('parseHead', () => {
  it('returns first 7 characters of hash', () => {
    const actual = parseHead('abc1234def5678\n');
    const expected = 'abc1234';
    expect(actual).toEqual(expected);
  });

  it('trims trailing whitespace before slicing', () => {
    const actual = parseHead('abc1234\n');
    const expected = 'abc1234';
    expect(actual).toEqual(expected);
  });

  it('handles a full 40-char SHA', () => {
    const actual = parseHead('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2\n');
    const expected = 'a1b2c3d';
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// parseStatus
// ---------------------------------------------------------------------------

describe('parseStatus — empty output', () => {
  it('returns empty arrays for empty string', () => {
    const actual = parseStatus('');
    const expected = { stagedFiles: [], unstagedFiles: [], untrackedFiles: [] };
    expect(actual).toEqual(expected);
  });
});

describe('parseStatus — staged changes', () => {
  it('collects path for a staged modification (M in X column)', () => {
    const actual = parseStatus('M  src/foo.ts\n');
    const expected = { stagedFiles: ['src/foo.ts'], unstagedFiles: [], untrackedFiles: [] };
    expect(actual).toEqual(expected);
  });

  it('collects path for a staged addition (A in X column)', () => {
    const actual = parseStatus('A  src/new.ts\n');
    const expected = { stagedFiles: ['src/new.ts'], unstagedFiles: [], untrackedFiles: [] };
    expect(actual).toEqual(expected);
  });

  it('collects path for a staged deletion (D in X column)', () => {
    const actual = parseStatus('D  src/old.ts\n');
    const expected = { stagedFiles: ['src/old.ts'], unstagedFiles: [], untrackedFiles: [] };
    expect(actual).toEqual(expected);
  });

  it('collects and sorts multiple staged file paths', () => {
    const actual = parseStatus('M  src/a.ts\nA  src/b.ts\nD  src/c.ts\n');
    const expected = { stagedFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'], unstagedFiles: [], untrackedFiles: [] };
    expect(actual).toEqual(expected);
  });
});

describe('parseStatus — unstaged changes', () => {
  it('collects path for an unstaged modification (M in Y column)', () => {
    const actual = parseStatus(' M src/foo.ts\n');
    const expected = { stagedFiles: [], unstagedFiles: ['src/foo.ts'], untrackedFiles: [] };
    expect(actual).toEqual(expected);
  });

  it('collects path for an unstaged deletion (D in Y column)', () => {
    const actual = parseStatus(' D src/old.ts\n');
    const expected = { stagedFiles: [], unstagedFiles: ['src/old.ts'], untrackedFiles: [] };
    expect(actual).toEqual(expected);
  });
});

describe('parseStatus — untracked files', () => {
  it('collects path for an untracked file (?? prefix)', () => {
    const actual = parseStatus('?? src/untracked.ts\n');
    const expected = { stagedFiles: [], unstagedFiles: [], untrackedFiles: ['src/untracked.ts'] };
    expect(actual).toEqual(expected);
  });

  it('collects and sorts multiple untracked paths', () => {
    const actual = parseStatus('?? b.ts\n?? a.ts\n');
    const expected = { stagedFiles: [], unstagedFiles: [], untrackedFiles: ['a.ts', 'b.ts'] };
    expect(actual).toEqual(expected);
  });
});

describe('parseStatus — mixed changes', () => {
  it('adds a file to both staged and unstaged when both columns are set (MM)', () => {
    // MM = staged modification + unstaged modification on same file
    const actual = parseStatus('MM src/foo.ts\n');
    const expected = { stagedFiles: ['src/foo.ts'], unstagedFiles: ['src/foo.ts'], untrackedFiles: [] };
    expect(actual).toEqual(expected);
  });

  it('correctly separates staged, unstaged, and untracked in one output', () => {
    const output = `${['M  src/staged.ts', ' M src/unstaged.ts', '?? src/new.ts'].join('\n')}\n`;
    const actual = parseStatus(output);
    const expected = {
      stagedFiles: ['src/staged.ts'],
      unstagedFiles: ['src/unstaged.ts'],
      untrackedFiles: ['src/new.ts'],
    };
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// parseStash
// ---------------------------------------------------------------------------

describe('parseStash', () => {
  it('returns 0 for empty output (no stash entries)', () => {
    const actual = parseStash('');
    const expected = 0;
    expect(actual).toEqual(expected);
  });

  it('returns 1 for a single stash entry', () => {
    const actual = parseStash('stash@{0}: WIP on main: abc1234 some message\n');
    const expected = 1;
    expect(actual).toEqual(expected);
  });

  it('returns the correct count for multiple stash entries', () => {
    const output = 'stash@{0}: WIP on main: abc1234 message one\nstash@{1}: WIP on feature/x: def5678 message two\n';
    const actual = parseStash(output);
    const expected = 2;
    expect(actual).toEqual(expected);
  });

  it('ignores blank lines', () => {
    const actual = parseStash('stash@{0}: WIP on main: abc1234 msg\n\n');
    const expected = 1;
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// gatherGitSnapshot
// ---------------------------------------------------------------------------

describe('gatherGitSnapshot', () => {
  it('resolves with head empty string when rev-parse HEAD fails', async () => {
    const runner = (args: string[]): Promise<string> => {
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return Promise.reject(new Error('fatal: ambiguous argument HEAD'));
      }
      return Promise.resolve('');
    };
    const snapshot = await gatherGitSnapshot(runner);
    expect(snapshot.head).toEqual('');
  });
});
