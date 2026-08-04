import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';
import { markdownContentLines } from '../src/model/markdown/markdownLayout.js';
import { ACCENT, BOLD, BOLD_END, box, CODE_FG, DIM, FG, HEADING, ITALIC, ITALIC_END, link, R, STRIKE, STRIKE_END, SUB_BULLET, table } from '../src/model/markdown/palette.js';
import { getHighlighted } from '../src/view/renderConversation.js';

// The source-to-rendered pairs come from the mission's visual spec (spec/spec.mjs):
// its `rendered` array is the exact ANSI the renderer must emit. Code-body cases
// drive `getHighlighted` on both sides — cli-highlight's colours are its own
// contract; this verifies the renderer routes the fence to the box and label.
const COLS = 80;
const render = (src: string[]): string[] => markdownContentLines(src.join('\n'), COLS, '', getHighlighted);

describe('markdownContentLines — the fence boundary', () => {
  it('renders prose markdown but leaves fenced markdown literal', () => {
    const expected = [`${BOLD}${HEADING[0]}Hello${FG}${BOLD_END}`, '', ...box(getHighlighted('# Hello', 'md'), 'md')];

    const actual = render(['# Hello', '', '```md', '# Hello', '```']);

    expect(actual).toEqual(expected);
  });
});

describe('markdownContentLines — inline and block constructs', () => {
  it('grades headings by level with the marker stripped', () => {
    const expected = [`${BOLD}${HEADING[0]}Heading one${FG}${BOLD_END}`, `${BOLD}${HEADING[1]}Heading two${FG}${BOLD_END}`, `${BOLD}${HEADING[2]}Heading three${FG}${BOLD_END}`];

    const actual = render(['# Heading one', '## Heading two', '### Heading three']);

    expect(actual).toEqual(expected);
  });

  it('renders bold with the markers stripped', () => {
    const expected = [`Some ${BOLD}strong${BOLD_END} words`];

    const actual = render(['Some **strong** words']);

    expect(actual).toEqual(expected);
  });

  it('renders italic with the markers stripped', () => {
    const expected = [`Some ${ITALIC}emphasised${ITALIC_END} words`];

    const actual = render(['Some *emphasised* words']);

    expect(actual).toEqual(expected);
  });

  it('renders strikethrough with the markers stripped', () => {
    const expected = [`No ${STRIKE}mistake${STRIKE_END} here`];

    const actual = render(['No ~~mistake~~ here']);

    expect(actual).toEqual(expected);
  });

  it('renders inline code in colour with no background', () => {
    const expected = [`Call ${CODE_FG}marked.parse()${FG} to render`];

    const actual = render(['Call `marked.parse()` to render']);

    expect(actual).toEqual(expected);
  });

  it('renders a link as an underlined OSC 8 hyperlink', () => {
    const expected = [`See ${link('https://example.com', 'the docs')}`];

    const actual = render(['See [the docs](https://example.com)']);

    expect(actual).toEqual(expected);
  });

  it('renders an image as an OSC 8 hyperlink with the alt text as label', () => {
    const expected = [link('https://example.com/arch.png', 'architecture')];

    const actual = render(['![architecture](https://example.com/arch.png)']);

    expect(actual).toEqual(expected);
  });

  it('normalises an unordered list to bullets', () => {
    const expected = [`${ACCENT}\u2022${FG} first`, `${ACCENT}\u2022${FG} second`];

    const actual = render(['- first', '- second']);

    expect(actual).toEqual(expected);
  });

  it('keeps the numbers on an ordered list', () => {
    const expected = ['1. first', '2. second'];

    const actual = render(['1. first', '2. second']);

    expect(actual).toEqual(expected);
  });

  it('indents a nested list with a sub-bullet', () => {
    const expected = [`${ACCENT}\u2022${FG} parent`, `  ${DIM}${SUB_BULLET}${R} child one`, `  ${DIM}${SUB_BULLET}${R} child two`, `${ACCENT}\u2022${FG} parent two`];

    const actual = render(['- parent', '  - child one', '  - child two', '- parent two']);

    expect(actual).toEqual(expected);
  });

  it('hangs a hard-broken list item under the marker', () => {
    const expected = [`${ACCENT}\u2022${FG} first`, '  second'];

    const actual = render(['- first  ', '  second']);

    expect(actual).toEqual(expected);
  });

  it('gutters a blockquote with a dimmed italic body', () => {
    const expected = [`${DIM}\u2502${R} ${ITALIC}a quoted line${ITALIC_END}`, `${DIM}\u2502${R} ${ITALIC}spanning two${ITALIC_END}`];

    const actual = render(['> a quoted line', '> spanning two']);

    expect(actual).toEqual(expected);
  });

  it('renders a horizontal rule as a full-width dimmed line', () => {
    const expected = [`${DIM}${'\u2500'.repeat(48)}${R}`];

    const actual = render(['---']);

    expect(actual).toEqual(expected);
  });
});

describe('markdownContentLines — fenced code', () => {
  it('boxes fenced code with its language label, content highlighted', () => {
    const code = ['const main = () => {', "  console.log('Hello Warble');", '};'].join('\n');
    const expected = box(getHighlighted(code, 'ts'), 'ts');

    const actual = render(['```ts', code, '```']);

    expect(actual).toEqual(expected);
  });

  it('wraps a long code line inside the box instead of clipping it', () => {
    const line = 'a very long line that runs well past the box edge and wraps inside it instead of disappearing';
    const expected = box(getHighlighted(line, 'plaintext'), 'plaintext', 56);

    const actual = markdownContentLines(['```plaintext', line, '```'].join('\n'), 56, '', getHighlighted);

    expect(actual).toEqual(expected);
  });
});

describe('box — cap, wrap, and label-aware border', () => {
  it('caps to the width, wraps the over-long line, and sizes the border to the label', () => {
    const expected = [`${DIM}\u250c\u2500 ${ACCENT}ts${FG}${DIM} ${'\u2500'.repeat(3)}\u2510${R}`, `${DIM}\u2502${FG} abcdef ${DIM}\u2502${R}`, `${DIM}\u2502${FG} gh${' '.repeat(4)} ${DIM}\u2502${R}`, `${DIM}\u2514${'\u2500'.repeat(8)}\u2518${R}`];

    const actual = box(['abcdefgh'], 'ts', 10);

    expect(actual).toEqual(expected);
  });
});

describe('markdownContentLines — tables', () => {
  it('resolves the markdown inside each cell', () => {
    const expected = table(
      [
        ['Package', 'Role'],
        [`${CODE_FG}claude-sdk${FG}`, `${BOLD}wrapper${BOLD_END}`],
      ],
      [null, null],
    );

    const actual = render(['| Package | Role |', '| --- | --- |', '| `claude-sdk` | **wrapper** |']);

    expect(actual).toEqual(expected);
  });

  it('caps every line of a table too wide for the terminal', () => {
    const expected: number[] = [];
    const source = ['| Mission | State |', '| --- | --- |', '| a mission with a name far past the width | still on one line |'].join('\n');

    const actual = markdownContentLines(source, 40, '', getHighlighted)
      .map((l) => stringWidth(l))
      .filter((w) => w > 40);

    expect(actual).toEqual(expected);
  });
});

describe('table — columns hug their widest cell', () => {
  it('pads each column to its widest cell under a ruled bold header', () => {
    const sep = ` ${DIM}\u2502${R} `;
    const expected = [`${BOLD}left${BOLD_END}${sep}${BOLD}b${BOLD_END}`, `${DIM}${'\u2500'.repeat(4)}\u2500\u253c\u2500${'\u2500'.repeat(2)}${R}`, `1   ${sep}22`];

    const actual = table(
      [
        ['left', 'b'],
        ['1', '22'],
      ],
      [null, null],
    );

    expect(actual).toEqual(expected);
  });

  it('pads a short row out to the full column count', () => {
    const sep = ` ${DIM}\u2502${R} `;
    const expected = [`${BOLD}a${BOLD_END}${sep}${BOLD}b${BOLD_END}`, `${DIM}\u2500\u2500\u253c\u2500\u2500${R}`, `1 ${DIM}\u2502${R}`];

    const actual = table([['a', 'b'], ['1']], [null, null]);

    expect(actual).toEqual(expected);
  });
});

describe('table — column alignment', () => {
  const sep = ` ${DIM}\u2502${R} `;

  it('pushes a right-aligned column against its right edge', () => {
    const expected = [`  ${BOLD}Bytes${BOLD_END}${sep}  ${BOLD}Pct${BOLD_END}`, `${DIM}${'\u2500'.repeat(7)}\u2500\u253c\u2500${'\u2500'.repeat(5)}${R}`, `975,950${sep}29.7%`];

    const actual = table(
      [
        ['Bytes', 'Pct'],
        ['975,950', '29.7%'],
      ],
      ['right', 'right'],
    );

    expect(actual).toEqual(expected);
  });

  it('splits the gap either side of a centred column', () => {
    const expected = [`${BOLD}physical${BOLD_END}${sep}${BOLD}note${BOLD_END}`, `${DIM}${'\u2500'.repeat(8)}\u2500\u253c\u2500${'\u2500'.repeat(4)}${R}`, `   \u2713    ${sep}n`];

    const actual = table(
      [
        ['physical', 'note'],
        ['\u2713', 'n'],
      ],
      ['center', null],
    );

    expect(actual).toEqual(expected);
  });

  it('keeps the padding on a right-aligned last column, where it does not trail', () => {
    const expected = [`${BOLD}Type${BOLD_END}${sep}${BOLD}Count${BOLD_END}`, `${DIM}${'\u2500'.repeat(4)}\u2500\u253c\u2500${'\u2500'.repeat(5)}${R}`, `trap${sep}  116`];

    const actual = table(
      [
        ['Type', 'Count'],
        ['trap', '116'],
      ],
      [null, 'right'],
    );

    expect(actual).toEqual(expected);
  });

  it('carries the delimiter row alignment through to the rendered columns', () => {
    const expected = table(
      [
        ['Type', 'Count'],
        ['trap', '116'],
      ],
      [null, 'right'],
    );

    const actual = render(['| Type | Count |', '|---|---:|', '| trap | 116 |']);

    expect(actual).toEqual(expected);
  });
});

describe('table — measuring a cell', () => {
  const sep = ` ${DIM}\u2502${R} `;

  it('measures a linked cell by its visible label, not the url hidden in the escape', () => {
    const expected = [`${BOLD}Docs${BOLD_END}${sep}${BOLD}Name${BOLD_END}`, `${DIM}${'\u2500'.repeat(4)}\u2500\u253c\u2500${'\u2500'.repeat(4)}${R}`, `${link('https://example.com', 'x')}   ${sep}a`];

    const actual = render(['| Docs | Name |', '| --- | --- |', '| [x](https://example.com) | a |']);

    expect(actual).toEqual(expected);
  });

  it('measures a wide character by the cells it occupies on screen', () => {
    const expected = [`${BOLD}a${BOLD_END}     ${sep}${BOLD}b${BOLD_END}`, `${DIM}${'\u2500'.repeat(6)}\u2500\u253c\u2500\u2500${R}`, `\u65e5\u672c\u8a9e${sep}x`, `yyyy  ${sep}z`];

    const actual = render(['| a | b |', '| --- | --- |', '| \u65e5\u672c\u8a9e | x |', '| yyyy | z |']);

    expect(actual).toEqual(expected);
  });

  it('leaves no trailing whitespace on a row whose last cell is empty', () => {
    const expected: string[] = [];

    const actual = render(['| a | b |', '| --- | --- |', '| 1 | |']).filter((l) => /\s$/.test(l));

    expect(actual).toEqual(expected);
  });
});
