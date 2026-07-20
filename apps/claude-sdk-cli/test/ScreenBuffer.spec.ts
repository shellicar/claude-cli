import { describe, expect, it } from 'vitest';
import { buildGrid, diffToWrites, gridToLines, layoutRow } from '../src/view/ScreenBuffer.js';

describe('layoutRow', () => {
  it('lays plain text one cell per column and pads to width', () => {
    const expected = ['a', 'b', 'c', ' ', ' '];
    const actual = layoutRow('abc', 5);
    expect(actual).toEqual(expected);
  });

  it('clips text past the margin', () => {
    const expected = ['a', 'b', 'c'];
    const actual = layoutRow('abcdef', 3);
    expect(actual).toEqual(expected);
  });

  it('gives a wide grapheme its cell plus an empty continuation cell', () => {
    const expected = ['世', '', 'b', ' ', ' '];
    const actual = layoutRow('世b', 5);
    expect(actual).toEqual(expected);
  });
});

/**
 * Characterization tests for the plain-ASCII fast-path boundary a future optimization would rely on
 * (see the layoutRow performance discussion): a row of only 0x20–0x7E characters has no combining
 * marks and every character is width 1, so it could skip Intl.Segmenter/stringWidth entirely. These
 * pin down the exact current byte-for-byte output across the cases that boundary must reproduce
 * exactly — ASCII at/under/over width, ANSI-styled rows (which must NOT take that path), and the
 * non-ASCII cases (wide graphemes, combining marks, zero-width joins) that must also fall through to
 * the slow path unchanged. Passing before and after any fast-path change is the parity guarantee.
 */
describe('layoutRow — plain-ASCII fast-path boundary (characterization)', () => {
  it('lays out a row exactly at the column width with no padding or clipping', () => {
    const expected = ['a', 'b', 'c'];
    const actual = layoutRow('abc', 3);
    expect(actual).toEqual(expected);
  });

  it('lays out an empty row as all blanks', () => {
    const expected = [' ', ' ', ' '];
    const actual = layoutRow('', 3);
    expect(actual).toEqual(expected);
  });

  it('lays out a full ASCII printable range row (space through tilde) one cell per character', () => {
    const printableAscii = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
    const expected = printableAscii.split('');
    const actual = layoutRow(printableAscii, printableAscii.length);
    expect(actual).toEqual(expected);
  });

  it('still applies ANSI styling to an otherwise-plain-ASCII row, carrying the escape onto the next visible cell', () => {
    const expected = ['\x1b[31ma', 'b', 'c'];
    const actual = layoutRow('\x1b[31mabc', 3);
    expect(actual).toEqual(expected);
  });

  it('carries a trailing reset escape onto the last written cell rather than dropping it', () => {
    const expected = ['a', 'b', 'c\x1b[0m'];
    const actual = layoutRow('abc\x1b[0m', 3);
    expect(actual).toEqual(expected);
  });

  it('joins a combining mark onto the preceding cell instead of giving it its own column', () => {
    // 'e' + COMBINING ACUTE ACCENT (U+0301) forms one grapheme cluster — outside the plain-ASCII
    // range, so it must fall through to the segmenter path, not the fast path.
    const withCombining = 'e\u0301bc';
    const expected = ['e\u0301', 'b', 'c'];
    const actual = layoutRow(withCombining, 3);
    expect(actual).toEqual(expected);
  });

  it('clips a wide grapheme at the last column instead of overflowing past the margin', () => {
    const expected = ['a', '世', ''];
    const actual = layoutRow('a世', 3);
    expect(actual).toEqual(expected);
  });
});

describe('diffToWrites', () => {
  it('writes the whole row on the first paint', () => {
    const grid = buildGrid(['hi'], 3, 1);
    const expected = '\x1b[1;1Hhi ';
    const actual = diffToWrites(null, grid);
    expect(actual).toBe(expected);
  });

  it('rewrites the whole changed row from column 1', () => {
    const prev = buildGrid(['hi'], 3, 1);
    const next = buildGrid(['ho'], 3, 1);
    const expected = '\x1b[1;1Hho ';
    const actual = diffToWrites(prev, next);
    expect(actual).toBe(expected);
  });

  it('overwrites removed content with blanks when a row shrinks', () => {
    const prev = buildGrid(['xx'], 3, 1);
    const next = buildGrid(['x'], 3, 1);
    const expected = '\x1b[1;1Hx  ';
    const actual = diffToWrites(prev, next);
    expect(actual).toBe(expected);
  });

  it('re-establishes colour by rewriting the whole styled row, not a partial cell', () => {
    const prev = buildGrid(['\x1b[31mAB\x1b[0m'], 2, 1);
    const next = buildGrid(['\x1b[31mAC\x1b[0m'], 2, 1);
    const expected = '\x1b[1;1H\x1b[31mAC\x1b[0m';
    const actual = diffToWrites(prev, next);
    expect(actual).toBe(expected);
  });

  it('writes nothing for a row that is identical to the previous frame', () => {
    const prev = buildGrid(['same'], 6, 1);
    const next = buildGrid(['same'], 6, 1);
    const expected = '';
    const actual = diffToWrites(prev, next);
    expect(actual).toBe(expected);
  });
});

describe('no stale content across frames', () => {
  it('the grid is the source of truth: no fragment of the previous frame survives', () => {
    const cols = 12;
    const height = 4;
    buildGrid(['top', 'stream', 'tail marker', '> input'], cols, height);
    const next = buildGrid(['top', 'streamFULL12', 'tail marker', '> input'], cols, height);

    const expected = ['top', 'streamFULL12', 'tail marker', '> input'];
    const actual = gridToLines(next);
    expect(actual).toEqual(expected);
  });
});
