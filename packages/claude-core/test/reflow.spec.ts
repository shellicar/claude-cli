import { describe, expect, it } from 'vitest';
import { INVERSE_OFF, INVERSE_ON, RESET, YELLOW } from '../src/ansi';
import { wrapLine } from '../src/reflow';

describe('wrapLine', () => {
  it('plain text wraps at the column boundary', () => {
    // Baseline: no ANSI codes, split at exactly 10 visible chars.
    const actual = wrapLine('0123456789abc', 10);
    const expected = ['0123456789', 'abc'];
    expect(actual).toEqual(expected);
  });

  it('returns a single entry when the line fits without wrapping', () => {
    const actual = wrapLine('hello', 10);
    const expected = ['hello'];
    expect(actual).toEqual(expected);
  });

  // Symptom A: the ESC byte has zero measured width so it stays on the old line,
  // while the remaining bytes of the sequence ('[', '7', 'm') each measure as
  // width 1 and appear as literal text on the new line.
  it('does not strand the ESC byte when the cursor sequence falls on the wrap boundary', () => {
    // 10 visible chars fill the line exactly; cursor char at position 11 must wrap.
    // The ANSI codes have zero visible width and must travel with the cursor char.
    const line = `0123456789${INVERSE_ON} ${INVERSE_OFF}`;
    const actual = wrapLine(line, 10);
    const expected = ['0123456789', `${INVERSE_ON} ${INVERSE_OFF}`];
    expect(actual).toEqual(expected);
  });

  // Symptom B: non-ESC bytes of an ANSI sequence ('[', '3', '3', 'm') each measure
  // as width 1 when fed to stringWidth one grapheme at a time, inflating the apparent
  // line width and causing the split to fire too early.
  it('does not count ANSI color codes toward the visible line width', () => {
    // Visible text is 'helloworld!' = 11 chars; split should be at visible col 10.
    // \x1b[33m is 5 bytes but 0 visible width — must not shift the split point.
    const line = `${YELLOW}helloworld!${RESET}`;
    const actual = wrapLine(line, 10);
    const expected = [`${YELLOW}helloworld`, `!${RESET}`];
    expect(actual).toEqual(expected);
  });

  it('does not count a mid-line cursor sequence toward the visible line width', () => {
    // '01' + cursor 'X' + '3456789' = 10 visible chars on line 1, 'abc' overflows.
    // The 7 bytes of INVERSE_ON+INVERSE_OFF must not eat into the 10-col budget.
    const line = `01${INVERSE_ON}X${INVERSE_OFF}3456789abc`;
    const actual = wrapLine(line, 10);
    const expected = [`01${INVERSE_ON}X${INVERSE_OFF}3456789`, 'abc'];
    expect(actual).toEqual(expected);
  });
});
