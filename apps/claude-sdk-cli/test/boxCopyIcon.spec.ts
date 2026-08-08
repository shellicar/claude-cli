import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';
import { box, COPY_ICON } from '../src/model/markdown/palette.js';

const COLS = 80;
const drawn = (): string[] => box(['const a = 1;'], 'typescript', COLS).lines;

describe('COPY_ICON', () => {
  it('occupies exactly one cell', () => {
    const expected = 1;
    const actual = stringWidth(COPY_ICON);
    expect(actual).toBe(expected);
  });

  it('carries no variation selector, which tmux and iTerm2 measure differently', () => {
    const expected = false;
    const actual = COPY_ICON.includes('\ufe0f');
    expect(actual).toBe(expected);
  });
});

describe('box — copy affordance', () => {
  it('draws the copy icon in the top border', () => {
    const expected = true;
    const actual = drawn()[0]?.includes(COPY_ICON);
    expect(actual).toBe(expected);
  });

  it('still shows the language label alongside it', () => {
    const expected = true;
    const actual = drawn()[0]?.includes('typescript');
    expect(actual).toBe(expected);
  });

  it('keeps the top border as wide as a body row', () => {
    const lines = drawn();
    const expected = stringWidth(lines[1] ?? '');
    const actual = stringWidth(lines[0] ?? '');
    expect(actual).toBe(expected);
  });

  it('keeps the top border as wide as the bottom border', () => {
    const lines = drawn();
    const expected = stringWidth(lines[lines.length - 1] ?? '');
    const actual = stringWidth(lines[0] ?? '');
    expect(actual).toBe(expected);
  });

  it('adds no row to the box', () => {
    const expected = 3;
    const actual = drawn().length;
    expect(actual).toBe(expected);
  });
});
