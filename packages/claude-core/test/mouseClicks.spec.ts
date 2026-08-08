import { describe, expect, it } from 'vitest';
import { extractMouseSequences, type KeyAction } from '../src/input';

// SGR reports one-based coordinates, so `<0;3;4M` is column 3, row 4 on screen and
// column 2, row 3 in the grid the renderer addresses.
const buf = (s: string): Buffer => Buffer.from(s, 'latin1');
const leftPress = '\x1b[<0;3;4M';
const leftRelease = '\x1b[<0;3;4m';

describe('extractMouseSequences — left button', () => {
  it('reports a press with the grid coordinates under the pointer', () => {
    const expected: KeyAction[] = [{ type: 'mouse_down', col: 2, row: 3 }];
    const actual = extractMouseSequences(buf(leftPress)).actions;
    expect(actual).toEqual(expected);
  });

  it('reports a release with the grid coordinates under the pointer', () => {
    const expected: KeyAction[] = [{ type: 'mouse_up', col: 2, row: 3 }];
    const actual = extractMouseSequences(buf(leftRelease)).actions;
    expect(actual).toEqual(expected);
  });

  it('reports a press and its release as two actions in order', () => {
    const expected: KeyAction[] = [
      { type: 'mouse_down', col: 2, row: 3 },
      { type: 'mouse_up', col: 2, row: 3 },
    ];
    const actual = extractMouseSequences(buf(leftPress + leftRelease)).actions;
    expect(actual).toEqual(expected);
  });

  it('reports the release position when the pointer moved between the two', () => {
    const expected: KeyAction[] = [{ type: 'mouse_up', col: 40, row: 11 }];
    const actual = extractMouseSequences(buf('\x1b[<0;41;12m')).actions;
    expect(actual).toEqual(expected);
  });

  it('removes the click bytes from the passthrough', () => {
    const expected = '';
    const actual = extractMouseSequences(buf(leftPress)).passthrough.toString('latin1');
    expect(actual).toBe(expected);
  });

  it('holds a click split across two chunks until the rest arrives', () => {
    const expected = 0;
    const actual = extractMouseSequences(buf('\x1b[<0;3;')).actions.length;
    expect(actual).toBe(expected);
  });
});

describe('extractMouseSequences — buttons that are not a plain left click', () => {
  it('swallows a middle-button press', () => {
    const expected = 0;
    const actual = extractMouseSequences(buf('\x1b[<1;3;4M')).actions.length;
    expect(actual).toBe(expected);
  });

  it('swallows a right-button press', () => {
    const expected = 0;
    const actual = extractMouseSequences(buf('\x1b[<2;3;4M')).actions.length;
    expect(actual).toBe(expected);
  });

  it('swallows a left press held with shift, which is the terminal-selection gesture', () => {
    const expected = 0;
    const actual = extractMouseSequences(buf('\x1b[<4;3;4M')).actions.length;
    expect(actual).toBe(expected);
  });

  it('swallows a left drag, which reports motion rather than a click', () => {
    const expected = 0;
    const actual = extractMouseSequences(buf('\x1b[<32;3;4M')).actions.length;
    expect(actual).toBe(expected);
  });
});
