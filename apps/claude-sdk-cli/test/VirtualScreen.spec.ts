import { describe, expect, it } from 'vitest';
import { VirtualScreen } from './VirtualScreen.js';

// Test 1 of the ghost-text experiment: characterise the virtual screen's own
// last-column autowrap before trusting it to reproduce the defect. Every
// assertion records what the emulator actually does, so the suite passes by
// documenting reality. The two describe blocks pin the two documented terminal
// semantics the emulator can model.

describe('VirtualScreen — last-column autowrap (deferred / DEC wrapnext, the documented default)', () => {
  it('does not advance the row when the last column is filled', () => {
    const screen = new VirtualScreen({ columns: 8, rows: 6 });

    screen.write('x'.repeat(8));

    const expected = 0;
    const actual = screen.cursorRow;
    expect(actual).toBe(expected);
  });

  it('sets the pending-wrap flag when the last column is filled', () => {
    const screen = new VirtualScreen({ columns: 8, rows: 6 });

    screen.write('x'.repeat(8));

    const expected = true;
    const actual = screen.pendingWrap;
    expect(actual).toBe(expected);
  });

  it('wraps to the next row only when the following glyph arrives', () => {
    const screen = new VirtualScreen({ columns: 8, rows: 6 });

    screen.write('x'.repeat(8));
    screen.write('y');

    const expected = 1;
    const actual = screen.cursorRow;
    expect(actual).toBe(expected);
  });

  it('places the post-wrap glyph at the first column of the next row', () => {
    const screen = new VirtualScreen({ columns: 8, rows: 6 });

    screen.write('x'.repeat(8));
    screen.write('y');

    const expected = 'y';
    const actual = screen.lineAt(1);
    expect(actual).toBe(expected);
  });

  it('advances exactly one row when a newline follows a full-width write', () => {
    // The crux of the hypothesis: an LF after a last-column glyph is a single
    // advance that clears the pending wrap. It does NOT consume the pending wrap
    // as a second advance, so a full-width row plus a trailing \n stays one
    // physical line — there is nothing to strand under deferred wrap.
    const screen = new VirtualScreen({ columns: 8, rows: 6 });

    screen.write('x'.repeat(8));
    screen.write('\n');

    const expected = 1;
    const actual = screen.cursorRow;
    expect(actual).toBe(expected);
  });
});

describe('VirtualScreen — last-column autowrap (immediate, the divergent semantic)', () => {
  it('advances the row as soon as the last column is filled', () => {
    const screen = new VirtualScreen({ columns: 8, rows: 6, lastColumnWrap: 'immediate' });

    screen.write('x'.repeat(8));

    const expected = 1;
    const actual = screen.cursorRow;
    expect(actual).toBe(expected);
  });

  it('does not leave a pending-wrap flag set', () => {
    const screen = new VirtualScreen({ columns: 8, rows: 6, lastColumnWrap: 'immediate' });

    screen.write('x'.repeat(8));

    const expected = false;
    const actual = screen.pendingWrap;
    expect(actual).toBe(expected);
  });

  it('advances two rows for a full-width write followed by a newline', () => {
    // Under immediate wrap the last-column fill already advanced one row; the
    // trailing \n advances a second. This is the one-line slip the ghost rides:
    // paint intended a single physical line for the row, the terminal consumed
    // two.
    const screen = new VirtualScreen({ columns: 8, rows: 6, lastColumnWrap: 'immediate' });

    screen.write('x'.repeat(8));
    screen.write('\n');

    const expected = 2;
    const actual = screen.cursorRow;
    expect(actual).toBe(expected);
  });
});
