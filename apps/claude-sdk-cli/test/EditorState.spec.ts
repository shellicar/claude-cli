import { describe, expect, it } from 'vitest';
import { EditorState } from '../src/model/EditorState.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const key = (type: string, value = '') => ({ type, value }) as Parameters<EditorState['handleKey']>[0];

const char = (value: string) => key('char', value);

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('EditorState — initial state', () => {
  it('starts with one empty line', () => {
    const expected = 1;
    const actual = new EditorState().lines.length;
    expect(actual).toBe(expected);
  });

  it('starts with cursor at line 0', () => {
    const expected = 0;
    const actual = new EditorState().cursorLine;
    expect(actual).toBe(expected);
  });

  it('starts with cursor at col 0', () => {
    const expected = 0;
    const actual = new EditorState().cursorCol;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe('EditorState — reset', () => {
  it('clears lines back to one empty line', () => {
    const s = new EditorState();
    s.handleKey(char('hello'));
    s.reset();
    const expected = 1;
    const actual = s.lines.length;
    expect(actual).toBe(expected);
  });

  it('resets cursor line to 0', () => {
    const s = new EditorState();
    s.handleKey(char('hello'));
    s.handleKey(key('enter'));
    s.reset();
    const expected = 0;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('resets cursor col to 0', () => {
    const s = new EditorState();
    s.handleKey(char('hello'));
    s.reset();
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// char — insert
// ---------------------------------------------------------------------------

describe('EditorState — char', () => {
  it('inserts a character at the cursor', () => {
    const s = new EditorState();
    s.handleKey(char('a'));
    const expected = 'a';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('advances cursor col by the length of the value', () => {
    const s = new EditorState();
    s.handleKey(char('hi'));
    const expected = 2;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('inserts at cursor mid-line', () => {
    const s = new EditorState();
    s.handleKey(char('ac'));
    s.handleKey(key('home'));
    s.handleKey(key('right'));
    s.handleKey(char('b'));
    const expected = 'abc';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('returns true', () => {
    const expected = true;
    const actual = new EditorState().handleKey(char('x'));
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// enter — line split
// ---------------------------------------------------------------------------

describe('EditorState — enter', () => {
  it('increases line count by one', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    const expected = 2;
    const actual = s.lines.length;
    expect(actual).toBe(expected);
  });

  it('splits line content at the cursor', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('home'));
    s.handleKey(key('right')); // cursor after 'a'
    s.handleKey(key('enter'));
    const expected = 'a';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('puts the text after the cursor on the new line', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('home'));
    s.handleKey(key('right')); // cursor after 'a'
    s.handleKey(key('enter'));
    const expected = 'b';
    const actual = s.lines[1];
    expect(actual).toBe(expected);
  });

  it('moves cursor to line 1', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    const expected = 1;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('resets cursor col to 0', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// backspace
// ---------------------------------------------------------------------------

describe('EditorState — backspace', () => {
  it('deletes the character before the cursor', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('backspace'));
    const expected = 'a';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('moves cursor col back by one', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('backspace'));
    const expected = 1;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at col 0 joins with previous line', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    s.handleKey(char('cd'));
    s.handleKey(key('home'));
    s.handleKey(key('backspace'));
    const expected = 'abcd';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('at col 0 reduces line count by one', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    s.handleKey(key('backspace'));
    const expected = 1;
    const actual = s.lines.length;
    expect(actual).toBe(expected);
  });

  it('at col 0 sets cursor col to length of previous line', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    s.handleKey(key('backspace'));
    const expected = 2;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at col 0 on line 0 does nothing', () => {
    const s = new EditorState();
    s.handleKey(key('backspace'));
    const expected = 1;
    const actual = s.lines.length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('EditorState — delete', () => {
  it('deletes the character under the cursor', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('home'));
    s.handleKey(key('delete'));
    const expected = 'b';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('at EOL joins with next line', () => {
    const s = new EditorState({ lines: ['ab', 'cd'], cursorLine: 0, cursorCol: 2 });
    s.handleKey(key('delete'));
    const expected = 'abcd';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('at EOL of last line does nothing', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('delete'));
    const expected = 'ab';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ctrl+backspace — delete word left
// ---------------------------------------------------------------------------

describe('EditorState — ctrl+backspace', () => {
  it('deletes the word to the left of the cursor', () => {
    const s = new EditorState();
    s.handleKey(char('hello world'));
    s.handleKey(key('ctrl+backspace'));
    const expected = 'hello ';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('at col 0 joins with previous line', () => {
    const s = new EditorState();
    s.handleKey(char('first'));
    s.handleKey(key('enter'));
    s.handleKey(key('ctrl+backspace'));
    const expected = 'first';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ctrl+delete — delete word right
// ---------------------------------------------------------------------------

describe('EditorState — ctrl+delete', () => {
  it('deletes the word to the right of the cursor', () => {
    const s = new EditorState();
    s.handleKey(char('hello world'));
    s.handleKey(key('home'));
    s.handleKey(key('ctrl+delete'));
    const expected = ' world';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('at EOL joins with next line', () => {
    const s = new EditorState({ lines: ['first', 'second'], cursorLine: 0, cursorCol: 5 });
    s.handleKey(key('ctrl+delete'));
    const expected = 'firstsecond';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ctrl+k — kill to end of line
// ---------------------------------------------------------------------------

describe('EditorState — ctrl+k', () => {
  it('kills from cursor to end of line', () => {
    const s = new EditorState();
    s.handleKey(char('hello'));
    s.handleKey(key('home'));
    s.handleKey(key('right'));
    s.handleKey(key('ctrl+k'));
    const expected = 'h';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('at EOL joins with next line', () => {
    const s = new EditorState({ lines: ['ab', 'cd'], cursorLine: 0, cursorCol: 2 });
    s.handleKey(key('ctrl+k'));
    const expected = 'abcd';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ctrl+u — kill to start of line
// ---------------------------------------------------------------------------

describe('EditorState — ctrl+u', () => {
  it('kills from line start to cursor', () => {
    const s = new EditorState();
    s.handleKey(char('hello'));
    s.handleKey(key('home'));
    s.handleKey(key('right'));
    s.handleKey(key('right'));
    s.handleKey(key('ctrl+u'));
    const expected = 'llo';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('resets cursor col to 0', () => {
    const s = new EditorState();
    s.handleKey(char('hello'));
    s.handleKey(key('ctrl+u'));
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// left / right
// ---------------------------------------------------------------------------

describe('EditorState — left', () => {
  it('moves cursor col left', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('left'));
    const expected = 1;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at col 0 wraps to end of previous line', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    s.handleKey(key('left'));
    const expected = 2;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at col 0 on line 0 does nothing', () => {
    const s = new EditorState();
    s.handleKey(key('left'));
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('moves back by the full grapheme when at the end of a 2-code-unit emoji (D-2)', () => {
    // \uD83C\uDF89 is U+1F389 PARTY POPPER: 2 code units, 1 grapheme
    // After typing it, cursorCol = 2. One left should land at 0, not 1.
    const s = new EditorState();
    s.handleKey(char('\uD83C\uDF89'));
    s.handleKey(key('left'));
    const actual = s.cursorCol;
    const expected = 0;
    expect(actual).toBe(expected);
  });
});

describe('EditorState — right', () => {
  it('moves cursor col right', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('home'));
    s.handleKey(key('right'));
    const expected = 1;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('advances by the full grapheme when on a 2-code-unit emoji (D-2)', () => {
    // Type \uD83C\uDF89 then go home: cursor at 0. One right should land at 2, not 1.
    const s = new EditorState();
    s.handleKey(char('\uD83C\uDF89'));
    s.handleKey(key('home'));
    s.handleKey(key('right'));
    const actual = s.cursorCol;
    const expected = 2;
    expect(actual).toBe(expected);
  });

  it('at EOL wraps to start of next line', () => {
    const s = new EditorState({ lines: ['ab', ''], cursorLine: 0, cursorCol: 2 });
    s.handleKey(key('right'));
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at EOL wraps to next line index', () => {
    const s = new EditorState({ lines: ['ab', ''], cursorLine: 0, cursorCol: 2 });
    s.handleKey(key('right'));
    const expected = 1;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// home / end / ctrl+home / ctrl+end
// ---------------------------------------------------------------------------

describe('EditorState — home', () => {
  it('moves cursor col to 0', () => {
    const s = new EditorState();
    s.handleKey(char('hello'));
    s.handleKey(key('home'));
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

describe('EditorState — end', () => {
  it('moves cursor col to end of line', () => {
    const s = new EditorState();
    s.handleKey(char('hello'));
    s.handleKey(key('home'));
    s.handleKey(key('end'));
    const expected = 5;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

describe('EditorState — ctrl+home', () => {
  it('moves cursor to line 0', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    s.handleKey(char('cd'));
    s.handleKey(key('ctrl+home'));
    const expected = 0;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('moves cursor col to 0', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    s.handleKey(char('cd'));
    s.handleKey(key('ctrl+home'));
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

describe('EditorState — ctrl+end', () => {
  it('moves cursor to last line', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    s.handleKey(char('cd'));
    s.handleKey(key('ctrl+home'));
    s.handleKey(key('ctrl+end'));
    const expected = 1;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('moves cursor col to end of last line', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    s.handleKey(char('cd'));
    s.handleKey(key('ctrl+home'));
    s.handleKey(key('ctrl+end'));
    const expected = 2;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ctrl+left / ctrl+right — word navigation
// ---------------------------------------------------------------------------

describe('EditorState — ctrl+left', () => {
  it('jumps to start of current word', () => {
    const s = new EditorState();
    s.handleKey(char('hello world'));
    s.handleKey(key('ctrl+left'));
    const expected = 6;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('skips trailing spaces before jumping over the preceding word', () => {
    const s = new EditorState();
    // Three trailing spaces — cursor lands after them at col 8.
    // ctrl+left skips the spaces (c: 8→5), then skips 'hello' (c: 5→0).
    s.handleKey(char('hello   '));
    s.handleKey(key('ctrl+left'));
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

describe('EditorState — ctrl+right', () => {
  it('jumps to end of current word', () => {
    const s = new EditorState();
    s.handleKey(char('hello world'));
    s.handleKey(key('home'));
    s.handleKey(key('ctrl+right'));
    const expected = 5;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ctrl+enter — not handled by EditorState
// ---------------------------------------------------------------------------

describe('EditorState — ctrl+enter', () => {
  it('returns false', () => {
    const expected = false;
    const actual = new EditorState().handleKey(key('ctrl+enter'));
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// unknown key
// ---------------------------------------------------------------------------

describe('EditorState — unknown key', () => {
  it('returns false', () => {
    const expected = false;
    const actual = new EditorState().handleKey(key('f1'));
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// text getter
// ---------------------------------------------------------------------------

describe('EditorState — text', () => {
  it('joins lines with newline', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    s.handleKey(char('cd'));
    const expected = 'ab\ncd';
    const actual = s.text;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// moveUpVisual
// ---------------------------------------------------------------------------

describe('EditorState — moveUpVisual', () => {
  it('within a wrapped line, stays on the same logical line', () => {
    // 17-char line wraps to 2 visual rows at cols=10, prefixWidth=3
    // cursorCol=12: visualPos=15, row=1 — after up, still on logical line 0
    const s = new EditorState({ lines: ['a'.repeat(17)], cursorLine: 0, cursorCol: 12 });
    s.moveUpVisual(10, 3);
    const expected = 0;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('within a wrapped line, moves to the row above at the same visual column', () => {
    // cursorCol=12: visualPos=15, row=1, colInRow=5
    // targetPos=(0)*10+5=5; targetInLine=5-3=2; colFromVisual('aaa...',2)=2
    const s = new EditorState({ lines: ['a'.repeat(17)], cursorLine: 0, cursorCol: 12 });
    s.moveUpVisual(10, 3);
    const expected = 2;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at the first visual row of a logical line, moves to the previous logical line', () => {
    const s = new EditorState({ lines: ['abc', 'def'], cursorLine: 1, cursorCol: 0 });
    s.moveUpVisual(10, 3);
    const expected = 0;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('at the first visual row of a logical line, lands at the matching column in the previous line', () => {
    // cursor at line 1, col 3: visualPos=6, colInRow=6
    // prevLine='abcde', prevTotalVisual=8, prevRowCount=1
    // prevTargetPos=min(6,8)=6; targetInLine=6-3=3; colFromVisual('abcde',3)=3
    const s = new EditorState({ lines: ['abcde', 'fghij'], cursorLine: 1, cursorCol: 3 });
    s.moveUpVisual(10, 3);
    const expected = 3;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at the first visual row of the first logical line, does not move the cursor', () => {
    const s = new EditorState({ lines: ['abc'], cursorLine: 0, cursorCol: 0 });
    s.moveUpVisual(10, 3);
    const expected = 0;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('at the first visual row of the first logical line, returns true', () => {
    const expected = true;
    const actual = new EditorState().moveUpVisual(10, 3);
    expect(actual).toBe(expected);
  });

  it('clamps cursorCol when the destination row is shorter than the goal column', () => {
    // cursor at line 1, col 3 (end of 'cde'): visualPos=6, colInRow=6
    // prevLine='ab', prevTotalVisual=5, prevRowCount=1
    // prevTargetPos=min(6,5)=5; targetInLine=5-3=2; colFromVisual('ab',2)=2
    const s = new EditorState({ lines: ['ab', 'cde'], cursorLine: 1, cursorCol: 3 });
    s.moveUpVisual(10, 3);
    const expected = 2;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('within a wrapped line containing wide characters, moves to the row above at the same visual column', () => {
    // Line '中'×7 (14 visual cols of content) wraps at cols=10, prefixWidth=3.
    // Row 0: prefix + '中'×3 (offsets 0–2). Row 1: '中'×4 (offsets 3–6).
    // cursorCol=6: visualPos=15, row=1, colInRow=5.
    // moveUp → targetPos=5, targetInLine=2.
    // colFromVisual: after one '中', w=2; the second '中' would push w to 4>2 → return 1.
    const s = new EditorState({ lines: ['中'.repeat(7)], cursorLine: 0, cursorCol: 6 });
    s.moveUpVisual(10, 3);
    const expected = 1;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// moveDownVisual
// ---------------------------------------------------------------------------

describe('EditorState — moveDownVisual', () => {
  it('within a wrapped line, stays on the same logical line', () => {
    // 17-char line wraps to 2 visual rows; cursor is on row 0
    const s = new EditorState({ lines: ['a'.repeat(17)], cursorLine: 0, cursorCol: 3 });
    s.moveDownVisual(10, 3);
    const expected = 0;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('within a wrapped line, moves to the row below at the same visual column', () => {
    // cursorCol=3: visualPos=6, row=0, colInRow=6
    // targetPos=min(10+6,20)=16; targetInLine=16-3=13; colFromVisual('aaa...',13)=13
    const s = new EditorState({ lines: ['a'.repeat(17)], cursorLine: 0, cursorCol: 3 });
    s.moveDownVisual(10, 3);
    const expected = 13;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at the last visual row of a logical line, moves to the next logical line', () => {
    const s = new EditorState({ lines: ['abc', 'def'], cursorLine: 0, cursorCol: 0 });
    s.moveDownVisual(10, 3);
    const expected = 1;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('at the last visual row of a logical line, lands at the matching column in the next line', () => {
    // cursor at line 0, col 2: visualPos=5, colInRow=5
    // totalVisual=8, totalRows=1; move to next line
    // nextLine='fghij'; targetInLine=max(0,5-3)=2; colFromVisual('fghij',2)=2
    const s = new EditorState({ lines: ['abcde', 'fghij'], cursorLine: 0, cursorCol: 2 });
    s.moveDownVisual(10, 3);
    const expected = 2;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at the last visual row of the last logical line, does not move the cursor', () => {
    const s = new EditorState({ lines: ['abc'], cursorLine: 0, cursorCol: 3 });
    s.moveDownVisual(10, 3);
    const expected = 0;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('at the last visual row of the last logical line, returns true', () => {
    const expected = true;
    const actual = new EditorState().moveDownVisual(10, 3);
    expect(actual).toBe(expected);
  });

  it('clamps cursorCol when the destination line is shorter than the goal column', () => {
    // cursor at line 0, col 4: visualPos=7, colInRow=7
    // totalVisual=8, totalRows=1; move to next line
    // nextLine='ab'; targetInLine=max(0,7-3)=4; colFromVisual('ab',4)=2
    const s = new EditorState({ lines: ['abcde', 'ab'], cursorLine: 0, cursorCol: 4 });
    s.moveDownVisual(10, 3);
    const expected = 2;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('within a wrapped line containing wide characters, clamps to the grapheme boundary before an overshoot', () => {
    // Line 'a' + '中'×6 (1 + 12 = 13 visual cols of content) wraps at cols=10, prefixWidth=3.
    // cursorCol=0: visualPos=3, row=0, colInRow=3.
    // moveDown → targetPos=13, targetInLine=10.
    // colFromVisual: after 'a' and four '中', w=9; the next '中' would push w to 11>10 → return 5.
    const s = new EditorState({ lines: ['a' + '中'.repeat(6)], cursorLine: 0, cursorCol: 0 });
    s.moveDownVisual(10, 3);
    const expected = 5;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});
