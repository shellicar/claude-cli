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
    // After the W-1 fix: the first chunk ends with RESET, the second re-establishes YELLOW.
    const line = `${YELLOW}helloworld!${RESET}`;
    const actual = wrapLine(line, 10);
    const expected = [`${YELLOW}helloworld${RESET}`, `${YELLOW}!${RESET}`];
    expect(actual).toEqual(expected);
  });

  it('does not count a mid-line cursor sequence toward the visible line width', () => {
    // '01' + cursor 'X' + '3456789' = 10 visible chars on line 1, 'abc' overflows.
    // The 7 bytes of INVERSE_ON+INVERSE_OFF must not eat into the 10-col budget.
    // INVERSE_ON (\x1b[7m) and INVERSE_OFF (\x1b[27m) are both SGR sequences, so
    // their combined state is carried to the continuation line (visually a no-op).
    const line = `01${INVERSE_ON}X${INVERSE_OFF}3456789abc`;
    const actual = wrapLine(line, 10);
    const expected = [`01${INVERSE_ON}X${INVERSE_OFF}3456789${RESET}`, `${INVERSE_ON}${INVERSE_OFF}abc`];
    expect(actual).toEqual(expected);
  });
});

describe('wrapLine — ANSI state continuations (W-1)', () => {
  it('continuation line starts with the colour that was active at the break point', () => {
    // 15 yellow A's wrap at col 10: the second chunk must re-establish YELLOW.
    const line = `${YELLOW}${'A'.repeat(15)}${RESET}`;
    const wrapped = wrapLine(line, 10);
    const actual = (wrapped[1] ?? '').startsWith(YELLOW);
    const expected = true;
    expect(actual).toBe(expected);
  });

  it('non-last wrapped line ends with a reset when colour is active', () => {
    const line = `${YELLOW}${'A'.repeat(15)}${RESET}`;
    const wrapped = wrapLine(line, 10);
    const actual = (wrapped[0] ?? '').endsWith(RESET);
    const expected = true;
    expect(actual).toBe(expected);
  });

  it('no reset is added to a non-last line when no colour is active at the break', () => {
    // Plain text: no ANSI at all — no spurious reset should appear.
    const wrapped = wrapLine('A'.repeat(15), 10);
    const actual = (wrapped[0] ?? '').endsWith(RESET);
    const expected = false;
    expect(actual).toBe(expected);
  });

  it('colour state is re-established on every continuation line for multi-wrap lines', () => {
    // 25 yellow A's wrapped at 10: all three chunks must carry YELLOW.
    const line = `${YELLOW}${'A'.repeat(25)}${RESET}`;
    const wrapped = wrapLine(line, 10);
    const actual = (wrapped[2] ?? '').startsWith(YELLOW);
    const expected = true;
    expect(actual).toBe(expected);
  });

  it('a reset at the wrap boundary clears the carried state for subsequent continuations', () => {
    // 10 yellow A's fill line 0. RESET then 20 plain B's follow.
    // Line 1: starts with preState(YELLOW)+RESET+B's (pendingAnsi resets the re-establishment)
    // Line 2: no colour prefix (state was empty after line 1 break)
    const line = `${YELLOW}${'A'.repeat(10)}${RESET}${'B'.repeat(20)}`;
    const wrapped = wrapLine(line, 10);
    const actual = (wrapped[2] ?? '').startsWith(YELLOW);
    const expected = false;
    expect(actual).toBe(expected);
  });
});
