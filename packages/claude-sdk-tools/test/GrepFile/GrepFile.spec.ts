import { describe, expect, it } from 'vitest';
import { findMatches, type LineMatch } from '../../src/GrepFile/findMatches';
import { formatContextLine, formatMatchLine } from '../../src/GrepFile/formatLine';
import { buildWindows, mergeWindows, type Window } from '../../src/GrepFile/mergeWindows';
import { searchLines } from '../../src/GrepFile/searchLines';

const match = (line: number, col: number, length: number): LineMatch => ({ line, col, length }) satisfies LineMatch;

const win = (start: number, end: number, ...matches: LineMatch[]): Window => ({ start, end, matches }) satisfies Window;

// ─── findMatches ─────────────────────────────────────────────────────────────

describe('findMatches', () => {
  it('returns empty array when no matches found', () => {
    const expected: LineMatch[] = [];
    const actual = findMatches(['hello world'], /xyz/);
    expect(actual).toEqual(expected);
  });

  it('finds a single match on the first line', () => {
    const expected = [match(1, 6, 5)];
    const actual = findMatches(['hello world'], /world/);
    expect(actual).toEqual(expected);
  });

  it('finds multiple matches on the same line', () => {
    const expected = [match(1, 0, 3), match(1, 4, 3)];
    const actual = findMatches(['foo foo'], /foo/);
    expect(actual).toEqual(expected);
  });

  it('returns 1-based line numbers', () => {
    const expected = [match(2, 0, 3)];
    const actual = findMatches(['nope', 'foo'], /foo/);
    expect(actual).toEqual(expected);
  });

  it('returns 0-based column offsets', () => {
    const expected = [match(1, 4, 3)];
    const actual = findMatches(['    foo'], /foo/);
    expect(actual).toEqual(expected);
  });

  it('finds matches across multiple lines', () => {
    const expected = [match(1, 0, 3), match(3, 2, 3)];
    const actual = findMatches(['foo', 'bar', '  foo'], /foo/);
    expect(actual).toEqual(expected);
  });
});

// ─── mergeWindows ─────────────────────────────────────────────────────────────

describe('mergeWindows', () => {
  it('returns empty array for empty input', () => {
    const expected: Window[] = [];
    const actual = mergeWindows([]);
    expect(actual).toEqual(expected);
  });

  it('returns single window unchanged', () => {
    const expected = [win(3, 7, match(5, 0, 1))];
    const actual = mergeWindows([win(3, 7, match(5, 0, 1))]);
    expect(actual).toEqual(expected);
  });

  it('keeps non-overlapping windows separate when gap is 2 or more lines', () => {
    const expected = 2;
    const actual = mergeWindows([win(1, 5), win(7, 10)]).length;
    expect(actual).toEqual(expected);
  });

  it('merges touching windows where next start equals previous end plus one', () => {
    const expected = 1;
    const actual = mergeWindows([win(1, 5), win(6, 10)]).length;
    expect(actual).toEqual(expected);
  });

  it('merges overlapping windows', () => {
    const expected = [win(1, 10, match(3, 0, 1), match(8, 0, 1))];
    const actual = mergeWindows([win(1, 7, match(3, 0, 1)), win(4, 10, match(8, 0, 1))]);
    expect(actual).toEqual(expected);
  });

  it('merges a window fully contained within another', () => {
    const expected = 1;
    const actual = mergeWindows([win(1, 10), win(3, 7)]).length;
    expect(actual).toEqual(expected);
  });

  it('preserves the larger end when merging a contained window', () => {
    const expected = 10;
    const actual = mergeWindows([win(1, 10), win(3, 7)])[0].end;
    expect(actual).toEqual(expected);
  });

  it('merges multiple overlapping windows into one', () => {
    const expected = 1;
    const actual = mergeWindows([win(1, 5), win(4, 9), win(8, 12)]).length;
    expect(actual).toEqual(expected);
  });

  it('combines matches from all merged windows', () => {
    const expected = 2;
    const m1 = match(3, 0, 1);
    const m2 = match(8, 0, 1);
    const actual = mergeWindows([win(1, 7, m1), win(4, 10, m2)])[0].matches.length;
    expect(actual).toEqual(expected);
  });

  it('sorts windows by start line before merging', () => {
    const expected = [win(1, 10, match(3, 0, 1), match(8, 0, 1))];
    const actual = mergeWindows([win(4, 10, match(8, 0, 1)), win(1, 7, match(3, 0, 1))]);
    expect(actual).toEqual(expected);
  });
});

// ─── buildWindows ─────────────────────────────────────────────────────────────

describe('buildWindows', () => {
  it('clamps start to line 1', () => {
    const expected = 1;
    const actual = buildWindows([match(2, 0, 1)], 5, 100)[0].start;
    expect(actual).toEqual(expected);
  });

  it('clamps end to totalLines', () => {
    const expected = 10;
    const actual = buildWindows([match(9, 0, 1)], 5, 10)[0].end;
    expect(actual).toEqual(expected);
  });

  it('produces one window per match before merging', () => {
    const expected = 2;
    const actual = buildWindows([match(1, 0, 1), match(50, 0, 1)], 3, 100).length;
    expect(actual).toEqual(expected);
  });
});

// ─── formatMatchLine ──────────────────────────────────────────────────────────

describe('formatMatchLine', () => {
  it('returns the line unchanged when it fits within maxLength', () => {
    const expected = 'hello world';
    const actual = formatMatchLine('hello world', 6, 5, 200);
    expect(actual).toEqual(expected);
  });

  it('adds ellipsis on both sides when match is in the middle of a long line', () => {
    const line = 'a'.repeat(100) + 'TARGET' + 'b'.repeat(100);
    const actual = formatMatchLine(line, 100, 6, 20);
    expect(actual.startsWith('…')).toBe(true);
    expect(actual.endsWith('…')).toBe(true);
  });

  it('includes the match text in the output', () => {
    const line = 'a'.repeat(100) + 'TARGET' + 'b'.repeat(100);
    const actual = formatMatchLine(line, 100, 6, 20);
    expect(actual.includes('TARGET')).toBe(true);
  });

  it('omits left ellipsis when match is near the start', () => {
    const line = 'TARGET' + 'b'.repeat(200);
    const actual = formatMatchLine(line, 0, 6, 20);
    expect(actual.startsWith('…')).toBe(false);
  });

  it('omits right ellipsis when match is near the end', () => {
    const line = 'a'.repeat(200) + 'TARGET';
    const actual = formatMatchLine(line, 200, 6, 20);
    expect(actual.endsWith('…')).toBe(false);
  });
});

// ─── searchLines (skip / limit) ───────────────────────────────────────────────

describe('searchLines', () => {
  // 10 lines each containing exactly one "foo", plus non-matching lines between
  const lines = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? `match line ${i / 2 + 1}: foo here` : `context line ${i}`));
  const opts = { context: 0, maxLineLength: 200 };

  it('reports total matchCount regardless of skip and limit', () => {
    const expected = 10;
    const actual = searchLines(lines, /foo/, { ...opts, skip: 0, limit: 1 }).matchCount;
    expect(actual).toEqual(expected);
  });

  it('returns content for the first match when skip is 0 and limit is 1', () => {
    const { content } = searchLines(lines, /foo/, { ...opts, skip: 0, limit: 1 });
    expect(content.includes('match line 1')).toBe(true);
  });

  it('skips the first match and returns the second when skip is 1', () => {
    const { content } = searchLines(lines, /foo/, { ...opts, skip: 1, limit: 1 });
    expect(content.includes('match line 2')).toBe(true);
  });

  it('does not include the first match when skip is 1', () => {
    const { content } = searchLines(lines, /foo/, { ...opts, skip: 1, limit: 1 });
    expect(content.includes('match line 1')).toBe(false);
  });

  it('returns the correct match at a high skip value', () => {
    const { content } = searchLines(lines, /foo/, { ...opts, skip: 8, limit: 1 });
    expect(content.includes('match line 9')).toBe(true);
  });

  it('returns empty content when skip is past the last match', () => {
    const expected = '';
    const actual = searchLines(lines, /foo/, { ...opts, skip: 10, limit: 1 }).content;
    expect(actual).toEqual(expected);
  });

  it('returns multiple matches when limit is greater than 1', () => {
    const { content } = searchLines(lines, /foo/, { ...opts, skip: 0, limit: 3 });
    expect(content.includes('match line 1')).toBe(true);
    expect(content.includes('match line 2')).toBe(true);
    expect(content.includes('match line 3')).toBe(true);
  });

  it('returns only remaining matches when limit exceeds what is left after skip', () => {
    const { content } = searchLines(lines, /foo/, { ...opts, skip: 9, limit: 99 });
    expect(content.includes('match line 10')).toBe(true);
    expect(content.includes('match line 9')).toBe(false);
  });
});

// ─── formatContextLine ────────────────────────────────────────────────────────

describe('formatContextLine', () => {
  it('returns the line unchanged when it fits within maxLength', () => {
    const expected = 'short line';
    const actual = formatContextLine('short line', 200);
    expect(actual).toEqual(expected);
  });

  it('truncates from the right with an ellipsis', () => {
    const line = 'a'.repeat(300);
    const actual = formatContextLine(line, 200);
    expect(actual.endsWith('…')).toBe(true);
  });

  it('truncates to exactly maxLength chars before the ellipsis', () => {
    const line = 'a'.repeat(300);
    const actual = formatContextLine(line, 200);
    expect(actual.length).toEqual(201); // 200 chars + ellipsis (1 char)
  });
});
