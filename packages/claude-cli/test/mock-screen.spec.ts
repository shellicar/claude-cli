import { describe, expect, it } from 'vitest';
import { MockScreen } from './MockScreen.js';

const ESC = '\x1B[';
const cursorUp = (n: number) => `${ESC}${n}A`;
const cursorTo = (col: number) => `${ESC}${col + 1}G`;
const clearLine = `${ESC}2K`;

describe('MockScreen', () => {
  it('writes characters at correct cursor position and advances cursor', () => {
    const screen = new MockScreen(80, 24);
    screen.write('AB');
    expect(screen.cursorRow).toBe(0);
    expect(screen.cursorCol).toBe(2);
    expect(screen.getRow(0)).toBe('AB');
  });

  it('writes characters at offset cursor position', () => {
    const screen = new MockScreen(80, 24);
    screen.write('\n\n'); // row 2
    screen.write('XY');
    expect(screen.cursorRow).toBe(2);
    expect(screen.cursorCol).toBe(2);
    expect(screen.getRow(2)).toBe('XY');
    expect(screen.getRow(0)).toBe('');
  });

  it('cursorUp moves cursor up N rows', () => {
    const screen = new MockScreen(80, 24);
    screen.write('\n\n\n'); // row 3
    screen.write(cursorUp(2));
    expect(screen.cursorRow).toBe(1);
  });

  it('cursorUp clamped at row 0', () => {
    const screen = new MockScreen(80, 24);
    screen.write('\n\n'); // row 2
    screen.write(cursorUp(10));
    expect(screen.cursorRow).toBe(0);
  });

  it('cursorUp by 1 moves up one row', () => {
    const screen = new MockScreen(80, 24);
    screen.write('\n'); // row 1
    screen.write(cursorUp(1));
    expect(screen.cursorRow).toBe(0);
  });

  it('cursorTo moves cursor to specified column', () => {
    const screen = new MockScreen(80, 24);
    screen.write(cursorTo(10));
    expect(screen.cursorCol).toBe(10);
  });

  it('cursorTo column 0 moves to first column', () => {
    const screen = new MockScreen(80, 24);
    screen.write('hello');
    screen.write(cursorTo(0));
    expect(screen.cursorCol).toBe(0);
  });

  it('clearLine clears the current row', () => {
    const screen = new MockScreen(80, 24);
    screen.write('hello world');
    screen.write(clearLine);
    expect(screen.getRow(0)).toBe('');
  });

  it('clearLine does not affect other rows', () => {
    const screen = new MockScreen(80, 24);
    screen.write('row0');
    screen.write('\n');
    screen.write('row1');
    screen.write('\r'); // move to col 0 on row 1
    screen.write(cursorUp(1)); // back to row 0
    screen.write(clearLine);
    expect(screen.getRow(0)).toBe('');
    expect(screen.getRow(1)).toBe('row1');
  });

  it('\\n above bottom row moves cursor down, no violation', () => {
    const screen = new MockScreen(80, 3);
    screen.write('\n'); // row 1
    expect(screen.cursorRow).toBe(1);
    expect(screen.scrollbackViolations).toBe(0);
  });

  it('\\n at bottom row increments scrollbackViolations', () => {
    const screen = new MockScreen(80, 3);
    screen.write('\n\n'); // row 2 (last row for 3-row screen)
    expect(screen.cursorRow).toBe(2);
    screen.write('\n');
    expect(screen.scrollbackViolations).toBe(1);
  });

  it('\\n at bottom row shifts rows up and clears new bottom row', () => {
    const screen = new MockScreen(80, 3);
    screen.write('A');
    screen.write('\n');
    screen.write('B');
    screen.write('\n');
    screen.write('C');
    // rows: A, B, C (cursorRow=2)
    screen.write('\n');
    // scroll: row0(A) lost, row1(B)->row0, row2(C)->row1, new empty row2
    expect(screen.getRow(0)).toBe('B');
    expect(screen.getRow(1)).toBe('C');
    expect(screen.getRow(2)).toBe('');
    expect(screen.scrollbackViolations).toBe(1);
  });

  it('assertNoScrollbackViolations passes when violations = 0', () => {
    const screen = new MockScreen(80, 24);
    screen.write('hello');
    expect(() => screen.assertNoScrollbackViolations()).not.toThrow();
  });

  it('assertNoScrollbackViolations throws when violations > 0', () => {
    const screen = new MockScreen(80, 1);
    screen.write('\n');
    expect(() => screen.assertNoScrollbackViolations()).toThrow();
  });

  it('writing fills a row enters pending-wrap; next char wraps to next row', () => {
    const screen = new MockScreen(5, 24);
    screen.write('ABCDE'); // 5 chars fills 5-col row, enters pending-wrap at last col
    expect(screen.cursorRow).toBe(0);
    expect(screen.cursorCol).toBe(4);
    expect(screen.getRow(0)).toBe('ABCDE');
    screen.write('F'); // next char triggers wrap to row 1
    expect(screen.cursorRow).toBe(1);
    expect(screen.cursorCol).toBe(1);
    expect(screen.getRow(1)).toBe('F');
  });

  it('writing past end of last row causes scrollback violation', () => {
    const screen = new MockScreen(5, 2);
    screen.write('\n'); // row 1 (last row for 2-row screen)
    screen.write('ABCDE'); // fills last row, enters pending-wrap, no violation yet
    expect(screen.scrollbackViolations).toBe(0);
    screen.write('F'); // triggers wrap past last row, scrollback violation
    expect(screen.scrollbackViolations).toBe(1);
  });

  it('\\r moves cursor to column 0', () => {
    const screen = new MockScreen(80, 24);
    screen.write('hello');
    screen.write('\r');
    expect(screen.cursorCol).toBe(0);
    expect(screen.cursorRow).toBe(0);
  });

  it('\\r followed by write overwrites from column 0', () => {
    const screen = new MockScreen(80, 24);
    screen.write('AAAAA');
    screen.write('\r');
    screen.write('BB');
    expect(screen.getRow(0)).toBe('BBAAA');
  });

  it('getRow trims trailing empty cells', () => {
    const screen = new MockScreen(80, 24);
    screen.write('hi');
    expect(screen.getRow(0)).toBe('hi');
    expect(screen.getRow(0).length).toBe(2);
  });

  it('getRow returns empty string for blank row', () => {
    const screen = new MockScreen(80, 24);
    expect(screen.getRow(0)).toBe('');
  });

  it('ESC[row;colH moves cursor to absolute position (1-based)', () => {
    const screen = new MockScreen(80, 24);
    screen.write('\x1B[5;10H'); // row 5, col 10 (1-based)
    expect(screen.cursorRow).toBe(4); // 0-based
    expect(screen.cursorCol).toBe(9); // 0-based
  });

  it('ESC[1;1H moves cursor to top-left', () => {
    const screen = new MockScreen(80, 24);
    screen.write('\n\n\n'); // row 3
    screen.write('\x1B[1;1H');
    expect(screen.cursorRow).toBe(0);
    expect(screen.cursorCol).toBe(0);
  });

  it('ESC[row;colH clamps to screen boundaries', () => {
    const screen = new MockScreen(10, 5);
    screen.write('\x1B[99;99H');
    expect(screen.cursorRow).toBe(4); // clamped to rows - 1
    expect(screen.cursorCol).toBe(9); // clamped to columns - 1
  });
});
