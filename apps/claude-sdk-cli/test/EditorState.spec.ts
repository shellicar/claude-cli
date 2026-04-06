import { describe, expect, it } from 'vitest';
import { EditorState } from '../src/EditorState.js';

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
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    s.handleKey(char('cd'));
    s.handleKey(key('up'));
    s.handleKey(key('end'));
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
    const s = new EditorState();
    s.handleKey(char('first'));
    s.handleKey(key('enter'));
    s.handleKey(char('second'));
    s.handleKey(key('up'));
    s.handleKey(key('end'));
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
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    s.handleKey(char('cd'));
    s.handleKey(key('up'));
    s.handleKey(key('end'));
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

  it('at EOL wraps to start of next line', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    s.handleKey(key('up'));
    s.handleKey(key('end'));
    s.handleKey(key('right'));
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at EOL wraps to next line index', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    s.handleKey(key('up'));
    s.handleKey(key('end'));
    s.handleKey(key('right'));
    const expected = 1;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// up / down with col clamping
// ---------------------------------------------------------------------------

describe('EditorState — up', () => {
  it('moves cursor line up', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    s.handleKey(key('up'));
    const expected = 0;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('clamps cursor col to shorter line length', () => {
    const s = new EditorState();
    s.handleKey(char('a'));
    s.handleKey(key('enter'));
    s.handleKey(char('abc'));
    s.handleKey(key('up'));
    const expected = 1;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at line 0 does not change line', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('up'));
    const expected = 0;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('at line 0 returns true', () => {
    const expected = true;
    const actual = new EditorState().handleKey(key('up'));
    expect(actual).toBe(expected);
  });
});

describe('EditorState — down', () => {
  it('moves cursor line down', () => {
    const s = new EditorState();
    s.handleKey(char('ab'));
    s.handleKey(key('enter'));
    s.handleKey(key('up'));
    s.handleKey(key('down'));
    const expected = 1;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('clamps cursor col to shorter line length', () => {
    const s = new EditorState();
    s.handleKey(char('abc'));
    s.handleKey(key('enter'));
    s.handleKey(char('a'));
    s.handleKey(key('up'));
    s.handleKey(key('end'));
    s.handleKey(key('down'));
    const expected = 1;
    const actual = s.cursorCol;
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
