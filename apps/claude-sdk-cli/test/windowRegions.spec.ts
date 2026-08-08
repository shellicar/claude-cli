import { describe, expect, it } from 'vitest';
import { type ClickRegion, windowRegions } from '../src/model/ClickRegion.js';

const region = (row: number, text = 'const a = 1;'): ClickRegion => ({ row, startCol: 10, endCol: 12, text });

describe('windowRegions — transcript shorter than the window', () => {
  it('shifts a region down by the blank rows padded above the transcript', () => {
    const expected = 12;
    const actual = windowRegions([region(2)], 5, 15, 0)[0]?.row;
    expect(actual).toBe(expected);
  });

  it('shows every region, because the whole transcript fits', () => {
    const expected = 2;
    const actual = windowRegions([region(0), region(4)], 5, 15, 0).length;
    expect(actual).toBe(expected);
  });
});

describe('windowRegions — transcript longer than the window', () => {
  it('shifts a region up by the lines scrolled off the top', () => {
    const expected = 0;
    const actual = windowRegions([region(90)], 100, 10, 0)[0]?.row;
    expect(actual).toBe(expected);
  });

  it('keeps a region on the last visible row while pinned to the bottom', () => {
    const expected = 9;
    const actual = windowRegions([region(99)], 100, 10, 0)[0]?.row;
    expect(actual).toBe(expected);
  });

  it('drops a region that sits above the window', () => {
    const expected = 0;
    const actual = windowRegions([region(89)], 100, 10, 0).length;
    expect(actual).toBe(expected);
  });

  it('moves a region down the screen as the transcript is scrolled back', () => {
    const expected = 5;
    const actual = windowRegions([region(90)], 100, 10, 5)[0]?.row;
    expect(actual).toBe(expected);
  });

  it('drops a region once scrolling has pushed it off the bottom', () => {
    const expected = 0;
    const actual = windowRegions([region(99)], 100, 10, 5).length;
    expect(actual).toBe(expected);
  });

  it('drops a region on the row the scroll indicator takes over', () => {
    const expected = 0;
    const actual = windowRegions([region(94)], 100, 10, 5).length;
    expect(actual).toBe(expected);
  });
});

describe('windowRegions — what it carries through', () => {
  it('leaves the first column of the span alone', () => {
    const expected = 10;
    const actual = windowRegions([region(90)], 100, 10, 0)[0]?.startCol;
    expect(actual).toBe(expected);
  });

  it('leaves the last column of the span alone', () => {
    const expected = 12;
    const actual = windowRegions([region(90)], 100, 10, 0)[0]?.endCol;
    expect(actual).toBe(expected);
  });

  it('carries the payload through unchanged', () => {
    const expected = 'const a = 1;';
    const actual = windowRegions([region(90)], 100, 10, 0)[0]?.text;
    expect(actual).toBe(expected);
  });
});
