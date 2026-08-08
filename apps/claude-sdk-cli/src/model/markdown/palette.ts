/**
 * The markdown renderer's ANSI palette and the primitives that need exact byte
 * sequences: the OSC 8 hyperlink, the boxed code block, and the table. Codes are copied
 * verbatim from the mission's visual spec (spec/spec.mjs) — that rendered output
 * is the contract, so this owns its palette rather than reaching for claude-core's
 * ansi constants (whose DIM is `\x1b[2m`, not the spec's bright-black `\x1b[90m`).
 *
 * Pure strings only: no `marked`, no `cli-highlight`. Syntax colour for code
 * bodies is injected from the view as a CodeDecorator, so this sits at the
 * bottom layer alongside blockLayout.
 */

import { wrapLine } from '@shellicar/claude-core/reflow';
import stringWidth from 'string-width';

const e = (s: string | number): string => `\x1b[${s}m`;

export const R = e(0);
export const FG = e(39);
export const BOLD = e(1);
export const BOLD_END = e(22);
export const ITALIC = e(3);
export const ITALIC_END = e(23);
export const STRIKE = e(9);
export const STRIKE_END = e(29);
export const UL = e(4);
export const UL_END = e(24);
export const DIM = e(90);
export const ACCENT = e('38;5;33');
export const LINK = e('38;5;39');
export const CODE_FG = e('38;5;180');

/** Heading colour graded by level; h4+ reuse h3 (the spec grades three levels). */
export const HEADING = [e('38;5;39'), e('38;5;74'), e('38;5;110')];

/**
 * The clickable copy affordance drawn in a code box's top border. Deliberately not an
 * emoji: a VS16 sequence is measured differently by tmux and by iTerm2, which corrupts
 * the row on redraw, and the box's width invariant depends on this being one cell.
 */
export const COPY_ICON = '\u29c9';

export const BULLET = '\u2022';
export const SUB_BULLET = '\u25e6';

// OSC 8 hyperlink. The terminator is ST = ESC backslash (matching the spec).
const ST = '\x1b\\';
export const osc8 = (url: string, label: string): string => `\x1b]8;;${url}${ST}${label}\x1b]8;;${ST}`;

// Width is measured with `string-width`, the same authority the wrap and paint paths
// use. Counting code units after stripping SGR misses an OSC 8 hyperlink's hidden url
// entirely and mis-sizes every wide or combining glyph (#391).

/** An underlined, link-coloured OSC 8 hyperlink (underline is the fallback when the terminal ignores OSC 8). */
export function link(href: string, label: string): string {
  return UL + LINK + osc8(href, label) + FG + UL_END;
}

/**
 * Draw a code body inside a box with a language label in the top border.
 *
 * Capped to `termWidth`: snug to the content when it fits, capped-and-wrapped when
 * it does not, so a long line is seen instead of clipping off the right edge. The
 * wrap is ANSI-aware (via `wrapLine`) so a syntax-highlighted line breaks on visible
 * width without splitting an escape sequence, and adds no visible characters — a
 * wrapped code line copies back exactly as written. The top border's dash count is
 * label-aware (`innerW - 1 - L`), so a label of any length lines up. Structure
 * matches the spec's box().
 */
export function box(bodyLines: string[], lang: string, termWidth = 80): string[] {
  const maxInner = Math.max(1, termWidth - 4);
  const wrapped: string[] = [];
  for (const l of bodyLines) {
    wrapped.push(...wrapLine(l, maxInner));
  }
  const labelWidth = stringWidth(lang);
  const innerW = Math.min(maxInner, Math.max(labelWidth + 1, ...wrapped.map((l) => stringWidth(l))));
  const out: string[] = [];
  out.push(DIM + '\u250c\u2500 ' + ACCENT + lang + FG + DIM + ' ' + '\u2500'.repeat(Math.max(0, innerW - 1 - labelWidth)) + '\u2510' + R);
  for (const l of wrapped) {
    out.push(DIM + '\u2502' + FG + ' ' + l + ' '.repeat(Math.max(0, innerW - stringWidth(l))) + ' ' + DIM + '\u2502' + R);
  }
  out.push(DIM + '\u2514' + '\u2500'.repeat(innerW + 2) + '\u2518' + R);
  return out;
}

// The table's whole visual vocabulary. Style is a change to these three and the
// header emphasis in table(), so a different look never touches the layout walk.
const TABLE_SEP = ` ${DIM}\u2502${R} `;
const TABLE_RULE = '\u2500';
const TABLE_RULE_JOIN = '\u2500\u253c\u2500';

/** Which side a column's cells sit against. Matches the vocabulary `marked` reports. */
export type ColumnAlign = 'left' | 'center' | 'right' | null;

/** Pad a cell to its column width, putting the space on the side its alignment calls for. */
function padCell(cell: string, width: number, align: ColumnAlign): string {
  const gap = Math.max(0, width - stringWidth(cell));
  if (align === 'right') {
    return ' '.repeat(gap) + cell;
  }
  const before = align === 'center' ? gap >> 1 : 0;
  return ' '.repeat(before) + cell + ' '.repeat(gap - before);
}

const MIN_COLUMN = 3;
const SEP_WIDTH = 3;
// Held back on the right so a capped table sits in the same margin the content indent
// gives it on the left, rather than running flush against the terminal edge.
const RIGHT_MARGIN = 3;

/**
 * Shrink the widest column a cell at a time until the set fits `available`, so the
 * columns costing the most give up the most and a narrow one is never squeezed to
 * nothing. Gives up at MIN_COLUMN: on a terminal too narrow to hold the table at all,
 * an over-wide table beats an unreadable one.
 */
function fitColumns(natural: number[], available: number): number[] {
  const widths = [...natural];
  let over = widths.reduce((sum, w) => sum + w, 0) - available;
  while (over > 0) {
    const widest = Math.max(...widths);
    if (widest <= MIN_COLUMN) {
      break;
    }
    widths[widths.indexOf(widest)] = widest - 1;
    over--;
  }
  return widths;
}

/**
 * Draw a table: a bold header over a dimmed rule, dimmed separators between columns,
 * short rows padded out so a ragged table still lines up. `rows[0]` is the header and
 * `align` runs parallel to the columns.
 *
 * Snug to the content when it fits, capped and wrapped when it does not, the same rule
 * box follows. A column that gives up width wraps its cells over several rows, so the
 * content is still read rather than running off the right edge where nothing can reach
 * it: the CLI scrolls vertically only, and the two output surfaces clip and soft-wrap
 * differently, so an over-wide line has no single meaning.
 */
export function table(rows: string[][], align: ColumnAlign[], termWidth = 80): string[] {
  const [header, ...body] = rows;
  if (!header) {
    return [];
  }
  const columns = Math.max(...rows.map((r) => r.length));
  const natural = Array.from({ length: columns }, (_, i) => Math.max(...rows.map((r) => stringWidth(r[i] ?? ''))));
  const widths = fitColumns(natural, Math.max(columns * MIN_COLUMN, termWidth - SEP_WIDTH * (columns - 1) - RIGHT_MARGIN));
  // TABLE_SEP ends in a space and a padded cell can too, so a row whose last cell wraps
  // short or renders empty would otherwise carry invisible whitespace out of the terminal.
  const join = (cells: string[]): string => cells.join(TABLE_SEP).replace(/\s+$/, '');
  const rowLines = (cells: string[], open: string, close: string): string[] => {
    const wrapped = widths.map((w, i) => wrapLine(open + (cells[i] ?? '') + close, w));
    const height = Math.max(...wrapped.map((w) => w.length));
    return Array.from({ length: height }, (_, r) => join(widths.map((w, i) => padCell(wrapped[i]?.[r] ?? '', w, align[i] ?? null))));
  };

  return [...rowLines(header, BOLD, BOLD_END), DIM + widths.map((w) => TABLE_RULE.repeat(w)).join(TABLE_RULE_JOIN) + R, ...body.flatMap((cells) => rowLines(cells, '', ''))];
}
