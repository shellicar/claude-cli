/**
 * The markdown renderer's ANSI palette and the two primitives that need exact
 * byte sequences: the OSC 8 hyperlink and the boxed code block. Codes are copied
 * verbatim from the mission's visual spec (spec/spec.mjs) — that rendered output
 * is the contract, so this owns its palette rather than reaching for claude-core's
 * ansi constants (whose DIM is `\x1b[2m`, not the spec's bright-black `\x1b[90m`).
 *
 * Pure strings only: no `marked`, no `cli-highlight`. Syntax colour for code
 * bodies is injected from the view as a CodeDecorator, so this sits at the
 * bottom layer alongside blockLayout.
 */

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
export const HR_WIDTH = 48;

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
 * Draw a code body inside a box with a language label in the top border. Lines
 * are pre-sized and emitted unwrapped — a line wider than the terminal overflows,
 * matching the existing fence behaviour. Structure copied from the spec's box().
 */
export function box(bodyLines: string[], lang: string): string[] {
  const w = Math.max(0, ...bodyLines.map(visLen));
  const inner = w + 2;
  const out: string[] = [];
  out.push(DIM + '\u250c\u2500 ' + ACCENT + lang + FG + DIM + ' ' + '\u2500'.repeat(Math.max(0, inner - 5)) + '\u2510' + R);
  for (const l of bodyLines) {
    out.push(DIM + '\u2502' + FG + ' ' + l + ' '.repeat(Math.max(0, w - visLen(l))) + ' ' + DIM + '\u2502' + R);
  }
  out.push(DIM + '\u2514' + '\u2500'.repeat(inner) + '\u2518' + R);
  return out;
}
