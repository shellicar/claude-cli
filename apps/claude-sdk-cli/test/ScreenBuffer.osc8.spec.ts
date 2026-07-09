import { describe, expect, it } from 'vitest';
import { osc8 } from '../src/model/markdown/palette.js';
import { type Cell, layoutRow } from '../src/view/ScreenBuffer.js';

// The columns a row actually occupies: every cell that isn't a blank pad.
// An OSC 8 escape carries zero visible width, so the introducer and closer
// never occupy a column of their own — only the visible label does. (Fixtures
// use no wide graphemes, so a non-blank cell is exactly one occupied column.)
const occupiedColumns = (cells: Cell[]): number => cells.filter((cell) => cell !== ' ').length;

const RED = '\x1b[31m';
const RESET = '\x1b[0m';

describe('layoutRow — OSC 8 hyperlinks', () => {
  it('lays a bare-URL link to its label width, the URL shown once', () => {
    const url = 'https://ex.co/391';
    const expected = url.length;
    const actual = occupiedColumns(layoutRow(osc8(url, url), 80));
    expect(actual).toBe(expected);
  });

  it('leaves no visible column past the label — no leaked escape or doubled URL', () => {
    const url = 'https://ex.co/391';
    const expected = ' ';
    const actual = layoutRow(osc8(url, url), 80)[url.length];
    expect(actual).toBe(expected);
  });
});

describe('layoutRow — CSI/SGR rendering is unchanged', () => {
  it('carries an SGR colour as zero width onto its character', () => {
    const expected = [`${RED}A`, `B${RESET}`, ' ', ' '];
    const actual = layoutRow(`${RED}AB${RESET}`, 4);
    expect(actual).toEqual(expected);
  });
});
