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

  it('emits nothing when the grids are identical', () => {
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
