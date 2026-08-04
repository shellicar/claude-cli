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

export const BULLET = '\u2022';
export const SUB_BULLET = '\u25e6';

// OSC 8 hyperlink. The terminator is ST = ESC backslash (matching the spec).
const ST = '\x1b\\';
export const osc8 = (url: string, label: string): string => `\x1b]8;;${url}${ST}${label}\x1b]8;;${ST}`;

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching SGR escape sequences requires \x1b
const STRIP_ANSI = /\x1b\[[0-9;]*m/g;
/** Visible width: strip SGR codes, count code units. Mirrors the spec's measure. */
export const visLen = (s: string): number => s.replace(STRIP_ANSI, '').length;

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
  const labelWidth = visLen(lang);
  const innerW = Math.min(maxInner, Math.max(labelWidth + 1, ...wrapped.map(visLen)));
  const out: string[] = [];
  out.push(DIM + '\u250c\u2500 ' + ACCENT + lang + FG + DIM + ' ' + '\u2500'.repeat(Math.max(0, innerW - 1 - labelWidth)) + '\u2510' + R);
  for (const l of wrapped) {
    out.push(DIM + '\u2502' + FG + ' ' + l + ' '.repeat(Math.max(0, innerW - visLen(l))) + ' ' + DIM + '\u2502' + R);
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

/**
 * Pad a cell to its column width, putting the space on the side its alignment calls
 * for. Padding that would trail is dropped on the last column, where nothing follows
 * it: with no right border that space is invisible, and it copies out of the terminal
 * as noise. A right-aligned cell pads on the left, so it keeps its padding throughout.
 */
function padCell(cell: string, width: number, align: ColumnAlign, last: boolean): string {
  const gap = Math.max(0, width - visLen(cell));
  if (align === 'right') {
    return ' '.repeat(gap) + cell;
  }
  const before = align === 'center' ? gap >> 1 : 0;
  return ' '.repeat(before) + cell + (last ? '' : ' '.repeat(gap - before));
}

/**
 * Draw a table that hugs its content: every column takes the width of its widest
 * cell, a bold header sits over a dimmed rule, and dimmed separators divide the
 * columns. `rows[0]` is the header, and `align` runs parallel to the columns.
 *
 * There is deliberately no width cap. A wide table runs to its natural width and is
 * clipped by the terminal rather than wrapped or truncated, which keeps a row on one
 * line and the columns readable down the page. Short rows pad out, so a ragged table
 * still lines up.
 */
export function table(rows: string[][], align: ColumnAlign[]): string[] {
  const [header, ...body] = rows;
  if (!header) {
    return [];
  }
  const columns = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: columns }, (_, i) => Math.max(...rows.map((r) => visLen(r[i] ?? ''))));
  const row = (cells: string[], open: string, close: string): string => widths.map((w, i) => padCell(open + (cells[i] ?? '') + close, w, align[i] ?? null, i === columns - 1)).join(TABLE_SEP);

  return [row(header, BOLD, BOLD_END), DIM + widths.map((w) => TABLE_RULE.repeat(w)).join(TABLE_RULE_JOIN) + R, ...body.map((cells) => row(cells, '', ''))];
}
