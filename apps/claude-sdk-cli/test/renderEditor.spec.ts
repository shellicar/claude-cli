import { INVERSE_ON } from '@shellicar/claude-core/ansi';
import { describe, expect, it } from 'vitest';
import { EditorState } from '../src/model/EditorState.js';
import { renderEditor } from '../src/view/renderEditor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const char = (value: string) => ({ type: 'char' as const, value });
const key = (type: string) => ({ type }) as Parameters<EditorState['handleKey']>[0];

const COLS = 80;

function makeState(...lines: string[]): EditorState {
  const s = new EditorState();
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      s.handleKey(key('enter'));
    }
    s.handleKey(char(lines[i] ?? ''));
  }
  return s;
}

// ---------------------------------------------------------------------------
// Basic output shape
// ---------------------------------------------------------------------------

describe('renderEditor — output shape', () => {
  it('returns at least one line for an empty editor', () => {
    const expected = 1;
    const actual = renderEditor(new EditorState(), COLS).length;
    expect(actual).toBe(expected);
  });

  it('returns one line per editor line when all lines are short', () => {
    const s = makeState('hello', 'world');
    const expected = 2;
    const actual = renderEditor(s, COLS).length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Prefix
// ---------------------------------------------------------------------------

describe('renderEditor — prefix', () => {
  it('first line starts with the prompt emoji prefix', () => {
    const s = makeState('hello');
    const expected = true;
    const actual = (renderEditor(s, COLS)[0] ?? '').startsWith('💬 ');
    expect(actual).toBe(expected);
  });

  it('second line starts with the indent prefix, not the emoji', () => {
    const s = makeState('first', 'second');
    const expected = true;
    const actual = (renderEditor(s, COLS)[1] ?? '').startsWith('   ');
    expect(actual).toBe(expected);
  });

  it('second line does not start with the emoji prefix', () => {
    const s = makeState('first', 'second');
    const expected = false;
    const actual = (renderEditor(s, COLS)[1] ?? '').startsWith('💬 ');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Cursor highlighting
// ---------------------------------------------------------------------------

describe('renderEditor — cursor', () => {
  it('the cursor line contains INVERSE_ON', () => {
    const s = makeState('hello');
    const expected = true;
    const actual = (renderEditor(s, COLS)[0] ?? '').includes(INVERSE_ON);
    expect(actual).toBe(expected);
  });

  it('a non-cursor line does not contain INVERSE_ON', () => {
    const s = makeState('first', 'second');
    // cursor is on line 1 after makeState; line 0 should have no cursor marker
    const expected = false;
    const actual = (renderEditor(s, COLS)[0] ?? '').includes(INVERSE_ON);
    expect(actual).toBe(expected);
  });

  it('empty editor renders a space as the cursor target', () => {
    const expected = true;
    const actual = (renderEditor(new EditorState(), COLS)[0] ?? '').includes(`${INVERSE_ON} `);
    expect(actual).toBe(expected);
  });

  it('cursor at col 0 highlights the first character', () => {
    const s = makeState('hello');
    s.handleKey(key('home'));
    const expected = true;
    const actual = (renderEditor(s, COLS)[0] ?? '').includes(`${INVERSE_ON}h`);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Wrapping
// ---------------------------------------------------------------------------

describe('renderEditor — wrapping', () => {
  it('a line longer than cols produces multiple output lines', () => {
    const s = makeState('a'.repeat(COLS + 1));
    const expected = true;
    const actual = renderEditor(s, COLS).length > 1;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// No divider
// ---------------------------------------------------------------------------

describe('renderEditor — no divider', () => {
  it('does not include a divider line (─ character)', () => {
    const s = makeState('hello');
    const expected = false;
    const actual = renderEditor(s, COLS).some((line) => line.includes('─'));
    expect(actual).toBe(expected);
  });
});
