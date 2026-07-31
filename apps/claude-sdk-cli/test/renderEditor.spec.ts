import { INVERSE_OFF, INVERSE_ON } from '@shellicar/claude-core/ansi';
import type { KeyAction } from '@shellicar/claude-core/input';
import { describe, expect, it } from 'vitest';
import { createEditorContent, type EditorContent } from '../src/model/EditorContent.js';
import { handleKey } from '../src/model/editorTransitions.js';
import { IntlGraphemeSegmenter } from '../src/model/IntlGraphemeSegmenter.js';
import { renderEditor } from '../src/view/renderEditor.js';

const segmenter = new IntlGraphemeSegmenter();

const char = (value: string) => ({ type: 'char' as const, value });
const key = (type: string) => ({ type }) as KeyAction;

const COLS = 80;

function makeState(...lines: string[]): EditorContent {
  const s = createEditorContent();
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      handleKey(segmenter, s, key('enter'));
    }
    handleKey(segmenter, s, char(lines[i] ?? ''));
  }
  return s;
}

// ---------------------------------------------------------------------------
// Basic output shape
// ---------------------------------------------------------------------------

describe('renderEditor — output shape', () => {
  it('returns at least one line for an empty editor', () => {
    const expected = 1;
    const actual = renderEditor(segmenter, createEditorContent(), COLS).length;
    expect(actual).toBe(expected);
  });

  it('returns one line per editor line when all lines are short', () => {
    const s = makeState('hello', 'world');
    const expected = 2;
    const actual = renderEditor(segmenter, s, COLS).length;
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
    const actual = (renderEditor(segmenter, s, COLS)[0] ?? '').startsWith('💬 ');
    expect(actual).toBe(expected);
  });

  it('second line starts with the indent prefix, not the emoji', () => {
    const s = makeState('first', 'second');
    const expected = true;
    const actual = (renderEditor(segmenter, s, COLS)[1] ?? '').startsWith('   ');
    expect(actual).toBe(expected);
  });

  it('second line does not start with the emoji prefix', () => {
    const s = makeState('first', 'second');
    const expected = false;
    const actual = (renderEditor(segmenter, s, COLS)[1] ?? '').startsWith('💬 ');
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
    const actual = (renderEditor(segmenter, s, COLS)[0] ?? '').includes(INVERSE_ON);
    expect(actual).toBe(expected);
  });

  it('a non-cursor line does not contain INVERSE_ON', () => {
    const s = makeState('first', 'second');
    // cursor is on line 1 after makeState; line 0 should have no cursor marker
    const expected = false;
    const actual = (renderEditor(segmenter, s, COLS)[0] ?? '').includes(INVERSE_ON);
    expect(actual).toBe(expected);
  });

  it('empty editor renders a space as the cursor target', () => {
    const expected = true;
    const actual = (renderEditor(segmenter, createEditorContent(), COLS)[0] ?? '').includes(`${INVERSE_ON} `);
    expect(actual).toBe(expected);
  });

  it('cursor at col 0 highlights the first character', () => {
    const s = makeState('hello');
    handleKey(segmenter, s, key('home'));
    const expected = true;
    const actual = (renderEditor(segmenter, s, COLS)[0] ?? '').includes(`${INVERSE_ON}h`);
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
    const actual = renderEditor(segmenter, s, COLS).length > 1;
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
    const actual = renderEditor(segmenter, s, COLS).some((line) => line.includes('─'));
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Grapheme-aware cursor (D-2)
// ---------------------------------------------------------------------------

describe('renderEditor — emoji cursor (D-2)', () => {
  it('cursor on a 2-code-unit emoji does not produce lone surrogates in output', () => {
    // Type the party popper emoji (\uD83C\uDF89, 2 code units), go home so
    // the cursor is at position 0 (start of the emoji). renderEditor must
    // include the full grapheme inside the INVERSE block, not just the high
    // surrogate with the low surrogate dangling after INVERSE_OFF.
    const s = createEditorContent();
    handleKey(segmenter, s, char('\uD83C\uDF89'));
    handleKey(segmenter, s, key('home'));
    const output = renderEditor(segmenter, s, COLS).join('');
    // Matches a high surrogate NOT followed by a low surrogate, or a low
    // surrogate NOT preceded by a high surrogate. Paired surrogates (a
    // complete emoji like \uD83C\uDF89) do NOT match.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: testing for lone Unicode surrogates
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    const actual = loneSurrogate.test(output);
    const expected = false;
    expect(actual).toBe(expected);
  });

  it('cursor at the start of an emoji highlights the full emoji, not just the high surrogate', () => {
    const s = createEditorContent();
    handleKey(segmenter, s, char('\uD83C\uDF89'));
    handleKey(segmenter, s, key('home'));
    const output = renderEditor(segmenter, s, COLS).join('');
    // The inverse block should contain the full 2-code-unit emoji (\uD83C\uDF89)
    const actual = output.includes(`${INVERSE_ON}\uD83C\uDF89${INVERSE_OFF}`);
    const expected = true;
    expect(actual).toBe(expected);
  });
});
