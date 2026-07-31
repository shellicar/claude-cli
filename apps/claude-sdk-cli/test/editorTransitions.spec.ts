import type { KeyAction } from '@shellicar/claude-core/input';
import { describe, expect, it } from 'vitest';
import { createEditorContent, editorText } from '../src/model/EditorContent.js';
import { handleKey, moveDownVisual, moveUpVisual } from '../src/model/editorTransitions.js';
import { GRAPHEME_WINDOW } from '../src/model/graphemeBoundaries.js';
import { IntlGraphemeSegmenter } from '../src/model/IntlGraphemeSegmenter.js';
import { CountingSegmenter } from './CountingSegmenter.js';

const segmenter = new IntlGraphemeSegmenter();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const key = (type: string, value = '') => ({ type, value }) as KeyAction;

const char = (value: string) => key('char', value);

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('editor transitions — initial state', () => {
  it('starts with one empty line', () => {
    const expected = 1;
    const actual = createEditorContent().lines.length;
    expect(actual).toBe(expected);
  });

  it('starts with cursor at line 0', () => {
    const expected = 0;
    const actual = createEditorContent().cursorLine;
    expect(actual).toBe(expected);
  });

  it('starts with cursor at col 0', () => {
    const expected = 0;
    const actual = createEditorContent().cursorCol;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// char — insert
// ---------------------------------------------------------------------------

describe('editor transitions — char', () => {
  it('inserts a character at the cursor', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('a'));
    const expected = 'a';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('advances cursor col by the length of the value', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('hi'));
    const expected = 2;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('inserts at cursor mid-line', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ac'));
    handleKey(segmenter, s, key('home'));
    handleKey(segmenter, s, key('right'));
    handleKey(segmenter, s, char('b'));
    const expected = 'abc';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('returns true', () => {
    const expected = true;
    const actual = handleKey(segmenter, createEditorContent(), char('x'));
    expect(actual).toBe(expected);
  });

  it('merges a typed base with a following combining mark into one cluster', () => {
    // Line holds an orphan combining acute (U+0301); typing 'e' before it makes "é".
    const s = createEditorContent({ lines: ['́'], cursorLine: 0, cursorCol: 0 });
    handleKey(segmenter, s, char('e'));
    const expected = 'é';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('leaves the cursor after the merged cluster, not mid-grapheme', () => {
    const s = createEditorContent({ lines: ['́'], cursorLine: 0, cursorCol: 0 });
    handleKey(segmenter, s, char('e'));
    const expected = 2; // end of "é" (e + U+0301); the naive code-unit advance would stop at 1
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('lands the cursor after the full cluster for any forward-fusing insert', () => {
    // Each line holds a tail that fuses with the inserted char into one grapheme;
    // inserting at col 0 makes the whole line one cluster, so the cursor must sit
    // at its end. The old code-unit advance parked it mid-cluster.
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['\u0301', 'e'], // combining acute → "é"
      ['\uD83C\uDDFA', '\uD83C\uDDE6'], // regional indicators → 🇦🇺 flag
      ['\uFE0F', '\u2764'], // VS16 → emoji-presentation heart
    ];
    for (const [tail, ins] of cases) {
      const s = createEditorContent({ lines: [tail], cursorLine: 0, cursorCol: 0 });
      handleKey(segmenter, s, char(ins));
      const line = s.lines[0] ?? '';
      const expected = line.length;
      const actual = s.cursorCol;
      expect(actual).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// char — long lines (the graphemeBoundaryAtOrAfter windowing contract)
// ---------------------------------------------------------------------------

describe('editor transitions — char, long lines', () => {
  it('merges a typed base with a following combining mark even deep into a long line', () => {
    // A combining acute (U+0301) sits far past the fast-path's bounded window; typing 'e' right
    // before it must still fuse into "é", proving the window looks back far enough to catch it.
    const prefix = 'a'.repeat(1000);
    const s = createEditorContent({ lines: [`${prefix}\u0301`], cursorLine: 0, cursorCol: prefix.length });
    handleKey(segmenter, s, char('e'));
    const expected = `${prefix}e\u0301`;
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('lands the cursor after the merged cluster deep into a long line, not mid-grapheme', () => {
    const prefix = 'a'.repeat(1000);
    const s = createEditorContent({ lines: [`${prefix}\u0301`], cursorLine: 0, cursorCol: prefix.length });
    handleKey(segmenter, s, char('e'));
    const expected = prefix.length + 2; // past 'e' + the combining mark
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('does not merge across plain ASCII text deep into a long line (no false-positive fusing)', () => {
    const prefix = 'a'.repeat(1000);
    const s = createEditorContent({ lines: [`${prefix}bcd`], cursorLine: 0, cursorCol: prefix.length });
    handleKey(segmenter, s, char('X'));
    const expected = prefix.length + 1; // right after the inserted 'X', no fusing
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('merges a base with a combining-mark chain longer than the bounded window, not just up to it', () => {
    // 40 combining acutes — one grapheme cluster of 41 code units, well past GRAPHEME_WINDOW (32). If
    // the windowed scan trusted a candidate landing exactly at the window edge, the cursor would land
    // at 33 (mid-cluster) instead of 41 (the cluster's true end).
    const chain = '\u0301'.repeat(40);
    const s = createEditorContent({ lines: [chain], cursorLine: 0, cursorCol: 0 });
    handleKey(segmenter, s, char('e'));
    const expected = chain.length + 1;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  // The guard against re-segmenting the whole line on every keystroke. Counted rather than timed,
  // and driven through handleKey so it proves the path production runs, not a helper in isolation.
  it('segments a bounded number of code units when typing into a long line', () => {
    const counting = new CountingSegmenter();
    const content = createEditorContent({ lines: ['x'.repeat(10000)], cursorLine: 0, cursorCol: 5000 });
    handleKey(counting, content, char('y'));
    const expected = GRAPHEME_WINDOW * 2;
    const actual = counting.codeUnitsSegmented;
    expect(actual).toBe(expected);
  });

  it('segments the same number of code units regardless of how long the line already is', () => {
    const measure = (length: number): number => {
      const counting = new CountingSegmenter();
      const content = createEditorContent({ lines: ['x'.repeat(length)], cursorLine: 0, cursorCol: Math.floor(length / 2) });
      handleKey(counting, content, char('y'));
      return counting.codeUnitsSegmented;
    };
    const expected = measure(2000);
    const actual = measure(4000);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// enter — line split
// ---------------------------------------------------------------------------

describe('editor transitions — enter', () => {
  it('increases line count by one', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('enter'));
    const expected = 2;
    const actual = s.lines.length;
    expect(actual).toBe(expected);
  });

  it('splits line content at the cursor', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('home'));
    handleKey(segmenter, s, key('right')); // cursor after 'a'
    handleKey(segmenter, s, key('enter'));
    const expected = 'a';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('puts the text after the cursor on the new line', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('home'));
    handleKey(segmenter, s, key('right')); // cursor after 'a'
    handleKey(segmenter, s, key('enter'));
    const expected = 'b';
    const actual = s.lines[1];
    expect(actual).toBe(expected);
  });

  it('moves cursor to line 1', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('enter'));
    const expected = 1;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('resets cursor col to 0', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('enter'));
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// backspace
// ---------------------------------------------------------------------------

describe('editor transitions — backspace', () => {
  it('deletes the character before the cursor', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('backspace'));
    const expected = 'a';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('moves cursor col back by one', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('backspace'));
    const expected = 1;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at col 0 joins with previous line', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('enter'));
    handleKey(segmenter, s, char('cd'));
    handleKey(segmenter, s, key('home'));
    handleKey(segmenter, s, key('backspace'));
    const expected = 'abcd';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('at col 0 reduces line count by one', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('enter'));
    handleKey(segmenter, s, key('backspace'));
    const expected = 1;
    const actual = s.lines.length;
    expect(actual).toBe(expected);
  });

  it('at col 0 sets cursor col to length of previous line', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('enter'));
    handleKey(segmenter, s, key('backspace'));
    const expected = 2;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at col 0 on line 0 does nothing', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, key('backspace'));
    const expected = 1;
    const actual = s.lines.length;
    expect(actual).toBe(expected);
  });

  it('deletes a whole emoji grapheme (heart + VS16), not just the trailing variation selector', () => {
    // ❤️ is U+2764 + U+FE0F: 2 code units, 1 grapheme. One backspace must remove both,
    // not leave the bare U+2764 (❤) behind.
    const s = createEditorContent();
    handleKey(segmenter, s, char('❤️'));
    handleKey(segmenter, s, key('backspace'));
    const expected = '';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('moves the cursor to the grapheme start after deleting an emoji', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('❤️'));
    handleKey(segmenter, s, key('backspace'));
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('editor transitions — delete', () => {
  it('deletes the character under the cursor', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('home'));
    handleKey(segmenter, s, key('delete'));
    const expected = 'b';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('at EOL joins with next line', () => {
    const s = createEditorContent({ lines: ['ab', 'cd'], cursorLine: 0, cursorCol: 2 });
    handleKey(segmenter, s, key('delete'));
    const expected = 'abcd';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('at EOL of last line does nothing', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('delete'));
    const expected = 'ab';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('deletes a whole emoji grapheme under the cursor, not just the leading codepoint', () => {
    // ❤️ is U+2764 + U+FE0F: forward delete must remove the whole cluster.
    const s = createEditorContent({ lines: ['❤️'], cursorLine: 0, cursorCol: 0 });
    handleKey(segmenter, s, key('delete'));
    const expected = '';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ctrl+backspace — delete word left
// ---------------------------------------------------------------------------

describe('editor transitions — ctrl+backspace', () => {
  it('deletes the word to the left of the cursor', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('hello world'));
    handleKey(segmenter, s, key('ctrl+backspace'));
    const expected = 'hello ';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('at col 0 joins with previous line', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('first'));
    handleKey(segmenter, s, key('enter'));
    handleKey(segmenter, s, key('ctrl+backspace'));
    const expected = 'first';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ctrl+delete — delete word right
// ---------------------------------------------------------------------------

describe('editor transitions — ctrl+delete', () => {
  it('deletes the word to the right of the cursor', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('hello world'));
    handleKey(segmenter, s, key('home'));
    handleKey(segmenter, s, key('ctrl+delete'));
    const expected = ' world';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('at EOL joins with next line', () => {
    const s = createEditorContent({ lines: ['first', 'second'], cursorLine: 0, cursorCol: 5 });
    handleKey(segmenter, s, key('ctrl+delete'));
    const expected = 'firstsecond';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ctrl+k — kill to end of line
// ---------------------------------------------------------------------------

describe('editor transitions — ctrl+k', () => {
  it('kills from cursor to end of line', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('hello'));
    handleKey(segmenter, s, key('home'));
    handleKey(segmenter, s, key('right'));
    handleKey(segmenter, s, key('ctrl+k'));
    const expected = 'h';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('at EOL joins with next line', () => {
    const s = createEditorContent({ lines: ['ab', 'cd'], cursorLine: 0, cursorCol: 2 });
    handleKey(segmenter, s, key('ctrl+k'));
    const expected = 'abcd';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ctrl+u — kill to start of line
// ---------------------------------------------------------------------------

describe('editor transitions — ctrl+u', () => {
  it('kills from line start to cursor', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('hello'));
    handleKey(segmenter, s, key('home'));
    handleKey(segmenter, s, key('right'));
    handleKey(segmenter, s, key('right'));
    handleKey(segmenter, s, key('ctrl+u'));
    const expected = 'llo';
    const actual = s.lines[0];
    expect(actual).toBe(expected);
  });

  it('resets cursor col to 0', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('hello'));
    handleKey(segmenter, s, key('ctrl+u'));
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// left / right
// ---------------------------------------------------------------------------

describe('editor transitions — left', () => {
  it('moves cursor col left', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('left'));
    const expected = 1;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at col 0 wraps to end of previous line', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('enter'));
    handleKey(segmenter, s, key('left'));
    const expected = 2;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at col 0 on line 0 does nothing', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, key('left'));
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('moves back by the full grapheme when at the end of a 2-code-unit emoji (D-2)', () => {
    // \uD83C\uDF89 is U+1F389 PARTY POPPER: 2 code units, 1 grapheme
    // After typing it, cursorCol = 2. One left should land at 0, not 1.
    const s = createEditorContent();
    handleKey(segmenter, s, char('\uD83C\uDF89'));
    handleKey(segmenter, s, key('left'));
    const actual = s.cursorCol;
    const expected = 0;
    expect(actual).toBe(expected);
  });
});

describe('editor transitions — right', () => {
  it('moves cursor col right', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('home'));
    handleKey(segmenter, s, key('right'));
    const expected = 1;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('advances by the full grapheme when on a 2-code-unit emoji (D-2)', () => {
    // Type \uD83C\uDF89 then go home: cursor at 0. One right should land at 2, not 1.
    const s = createEditorContent();
    handleKey(segmenter, s, char('\uD83C\uDF89'));
    handleKey(segmenter, s, key('home'));
    handleKey(segmenter, s, key('right'));
    const actual = s.cursorCol;
    const expected = 2;
    expect(actual).toBe(expected);
  });

  it('at EOL wraps to start of next line', () => {
    const s = createEditorContent({ lines: ['ab', ''], cursorLine: 0, cursorCol: 2 });
    handleKey(segmenter, s, key('right'));
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at EOL wraps to next line index', () => {
    const s = createEditorContent({ lines: ['ab', ''], cursorLine: 0, cursorCol: 2 });
    handleKey(segmenter, s, key('right'));
    const expected = 1;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// home / end / ctrl+home / ctrl+end
// ---------------------------------------------------------------------------

describe('editor transitions — home', () => {
  it('moves cursor col to 0', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('hello'));
    handleKey(segmenter, s, key('home'));
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

describe('editor transitions — end', () => {
  it('moves cursor col to end of line', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('hello'));
    handleKey(segmenter, s, key('home'));
    handleKey(segmenter, s, key('end'));
    const expected = 5;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

describe('editor transitions — ctrl+home', () => {
  it('moves cursor to line 0', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('enter'));
    handleKey(segmenter, s, char('cd'));
    handleKey(segmenter, s, key('ctrl+home'));
    const expected = 0;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('moves cursor col to 0', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('enter'));
    handleKey(segmenter, s, char('cd'));
    handleKey(segmenter, s, key('ctrl+home'));
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

describe('editor transitions — ctrl+end', () => {
  it('moves cursor to last line', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('enter'));
    handleKey(segmenter, s, char('cd'));
    handleKey(segmenter, s, key('ctrl+home'));
    handleKey(segmenter, s, key('ctrl+end'));
    const expected = 1;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('moves cursor col to end of last line', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('enter'));
    handleKey(segmenter, s, char('cd'));
    handleKey(segmenter, s, key('ctrl+home'));
    handleKey(segmenter, s, key('ctrl+end'));
    const expected = 2;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ctrl+left / ctrl+right — word navigation
// ---------------------------------------------------------------------------

describe('editor transitions — ctrl+left', () => {
  it('jumps to start of current word', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('hello world'));
    handleKey(segmenter, s, key('ctrl+left'));
    const expected = 6;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('skips trailing spaces before jumping over the preceding word', () => {
    const s = createEditorContent();
    // Three trailing spaces — cursor lands after them at col 8.
    // ctrl+left skips the spaces (c: 8→5), then skips 'hello' (c: 5→0).
    handleKey(segmenter, s, char('hello   '));
    handleKey(segmenter, s, key('ctrl+left'));
    const expected = 0;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

describe('editor transitions — ctrl+right', () => {
  it('jumps to end of current word', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('hello world'));
    handleKey(segmenter, s, key('home'));
    handleKey(segmenter, s, key('ctrl+right'));
    const expected = 5;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ctrl+enter — not handled here
// ---------------------------------------------------------------------------

describe('editor transitions — ctrl+enter', () => {
  it('returns false', () => {
    const expected = false;
    const actual = handleKey(segmenter, createEditorContent(), key('ctrl+enter'));
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// unknown key
// ---------------------------------------------------------------------------

describe('editor transitions — unknown key', () => {
  it('returns false', () => {
    const expected = false;
    const actual = handleKey(segmenter, createEditorContent(), key('f1'));
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// text getter
// ---------------------------------------------------------------------------

describe('editor transitions — text', () => {
  it('joins lines with newline', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('ab'));
    handleKey(segmenter, s, key('enter'));
    handleKey(segmenter, s, char('cd'));
    const expected = 'ab\ncd';
    const actual = editorText(s);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// moveUpVisual
// ---------------------------------------------------------------------------

describe('editor transitions — moveUpVisual', () => {
  it('within a wrapped line, stays on the same logical line', () => {
    // 17-char line wraps to 2 visual rows at cols=10, prefixWidth=3
    // cursorCol=12: visualPos=15, row=1 — after up, still on logical line 0
    const s = createEditorContent({ lines: ['a'.repeat(17)], cursorLine: 0, cursorCol: 12 });
    moveUpVisual(segmenter, s, 10, 3);
    const expected = 0;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('within a wrapped line, moves to the row above at the same visual column', () => {
    // cursorCol=12: visualPos=15, row=1, colInRow=5
    // targetPos=(0)*10+5=5; targetInLine=5-3=2; colFromVisual('aaa...',2)=2
    const s = createEditorContent({ lines: ['a'.repeat(17)], cursorLine: 0, cursorCol: 12 });
    moveUpVisual(segmenter, s, 10, 3);
    const expected = 2;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at the first visual row of a logical line, moves to the previous logical line', () => {
    const s = createEditorContent({ lines: ['abc', 'def'], cursorLine: 1, cursorCol: 0 });
    moveUpVisual(segmenter, s, 10, 3);
    const expected = 0;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('at the first visual row of a logical line, lands at the matching column in the previous line', () => {
    // cursor at line 1, col 3: visualPos=6, colInRow=6
    // prevLine='abcde', prevTotalVisual=8, prevRowCount=1
    // prevTargetPos=min(6,8)=6; targetInLine=6-3=3; colFromVisual('abcde',3)=3
    const s = createEditorContent({ lines: ['abcde', 'fghij'], cursorLine: 1, cursorCol: 3 });
    moveUpVisual(segmenter, s, 10, 3);
    const expected = 3;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at the first visual row of the first logical line, does not move the cursor', () => {
    const s = createEditorContent({ lines: ['abc'], cursorLine: 0, cursorCol: 0 });
    moveUpVisual(segmenter, s, 10, 3);
    const expected = 0;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('at the first visual row of the first logical line, returns true', () => {
    const expected = true;
    const actual = moveUpVisual(segmenter, createEditorContent(), 10, 3);
    expect(actual).toBe(expected);
  });

  it('clamps cursorCol when the destination row is shorter than the goal column', () => {
    // cursor at line 1, col 3 (end of 'cde'): visualPos=6, colInRow=6
    // prevLine='ab', prevTotalVisual=5, prevRowCount=1
    // prevTargetPos=min(6,5)=5; targetInLine=5-3=2; colFromVisual('ab',2)=2
    const s = createEditorContent({ lines: ['ab', 'cde'], cursorLine: 1, cursorCol: 3 });
    moveUpVisual(segmenter, s, 10, 3);
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
    const s = createEditorContent({ lines: ['中'.repeat(7)], cursorLine: 0, cursorCol: 6 });
    moveUpVisual(segmenter, s, 10, 3);
    const expected = 1;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// moveDownVisual
// ---------------------------------------------------------------------------

describe('editor transitions — moveDownVisual', () => {
  it('within a wrapped line, stays on the same logical line', () => {
    // 17-char line wraps to 2 visual rows; cursor is on row 0
    const s = createEditorContent({ lines: ['a'.repeat(17)], cursorLine: 0, cursorCol: 3 });
    moveDownVisual(segmenter, s, 10, 3);
    const expected = 0;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('within a wrapped line, moves to the row below at the same visual column', () => {
    // cursorCol=3: visualPos=6, row=0, colInRow=6
    // targetPos=min(10+6,20)=16; targetInLine=16-3=13; colFromVisual('aaa...',13)=13
    const s = createEditorContent({ lines: ['a'.repeat(17)], cursorLine: 0, cursorCol: 3 });
    moveDownVisual(segmenter, s, 10, 3);
    const expected = 13;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at the last visual row of a logical line, moves to the next logical line', () => {
    const s = createEditorContent({ lines: ['abc', 'def'], cursorLine: 0, cursorCol: 0 });
    moveDownVisual(segmenter, s, 10, 3);
    const expected = 1;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('at the last visual row of a logical line, lands at the matching column in the next line', () => {
    // cursor at line 0, col 2: visualPos=5, colInRow=5
    // totalVisual=8, totalRows=1; move to next line
    // nextLine='fghij'; targetInLine=max(0,5-3)=2; colFromVisual('fghij',2)=2
    const s = createEditorContent({ lines: ['abcde', 'fghij'], cursorLine: 0, cursorCol: 2 });
    moveDownVisual(segmenter, s, 10, 3);
    const expected = 2;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('at the last visual row of the last logical line, does not move the cursor', () => {
    const s = createEditorContent({ lines: ['abc'], cursorLine: 0, cursorCol: 3 });
    moveDownVisual(segmenter, s, 10, 3);
    const expected = 0;
    const actual = s.cursorLine;
    expect(actual).toBe(expected);
  });

  it('at the last visual row of the last logical line, returns true', () => {
    const expected = true;
    const actual = moveDownVisual(segmenter, createEditorContent(), 10, 3);
    expect(actual).toBe(expected);
  });

  it('clamps cursorCol when the destination line is shorter than the goal column', () => {
    // cursor at line 0, col 4: visualPos=7, colInRow=7
    // totalVisual=8, totalRows=1; move to next line
    // nextLine='ab'; targetInLine=max(0,7-3)=4; colFromVisual('ab',4)=2
    const s = createEditorContent({ lines: ['abcde', 'ab'], cursorLine: 0, cursorCol: 4 });
    moveDownVisual(segmenter, s, 10, 3);
    const expected = 2;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });

  it('within a wrapped line containing wide characters, clamps to the grapheme boundary before an overshoot', () => {
    // Line 'a' + '中'×6 (1 + 12 = 13 visual cols of content) wraps at cols=10, prefixWidth=3.
    // cursorCol=0: visualPos=3, row=0, colInRow=3.
    // moveDown → targetPos=13, targetInLine=10.
    // colFromVisual: after 'a' and four '中', w=9; the next '中' would push w to 11>10 → return 5.
    const s = createEditorContent({ lines: ['a' + '中'.repeat(6)], cursorLine: 0, cursorCol: 0 });
    moveDownVisual(segmenter, s, 10, 3);
    const expected = 5;
    const actual = s.cursorCol;
    expect(actual).toBe(expected);
  });
});
