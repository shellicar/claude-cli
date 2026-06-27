import { cursorAt } from '@shellicar/claude-core/ansi';
import stringWidth from 'string-width';

/**
 * The renderer's model of the screen as a grid of cells. Each cell holds the
 * text printed for one column: a grapheme (optionally prefixed with the ANSI SGR
 * that styles it), a single space for a blank, or an empty string for the
 * trailing column of a wide grapheme.
 *
 * Rows of styled text are laid into a fixed cols x height grid. paint draws every
 * cell of every row, each at an absolute cursor position. Nothing depends on the
 * terminal advancing the cursor or wrapping at the margin, and no row is ever
 * skipped, so the ghost class — a stranded physical line still holding orphaned
 * content — cannot occur: the grid is the source of truth and every cell is
 * repainted from it on every frame. tmux re-renders the grid from its own model
 * on resize and on entering copy-mode, orphaning cells we never wrote; a full
 * repaint overwrites them rather than trusting a diff that says the row is clean.
 */
export type Cell = string;
export type Grid = Cell[][];

// A CSI escape sequence (colour/style). Treated as zero width and carried onto
// the next visible cell, so styling travels with its character.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences requires \x1b
const ANSI_RE = /\u001b\[[^a-zA-Z]*[a-zA-Z]/g;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Lay one styled row into `cols` cells, clipping anything past the margin. */
export function layoutRow(row: string, cols: number): Cell[] {
  const cells: Cell[] = new Array(cols).fill(' ');
  let col = 0;
  let pending = '';
  let last = -1;

  const placePlain = (text: string): void => {
    for (const { segment } of segmenter.segment(text)) {
      const width = Math.max(stringWidth(segment), 0);
      if (width === 0) {
        // A zero-width mark joins the previous cell, or the pending prefix.
        if (last >= 0) {
          cells[last] += segment;
        } else {
          pending += segment;
        }
        continue;
      }
      if (col >= cols) {
        return;
      }
      cells[col] = pending + segment;
      pending = '';
      for (let k = 1; k < width && col + k < cols; k++) {
        cells[col + k] = '';
      }
      last = col;
      col += width;
    }
  };

  let lastIndex = 0;
  for (const match of row.matchAll(ANSI_RE)) {
    placePlain(row.slice(lastIndex, match.index));
    pending += match[0];
    lastIndex = match.index + match[0].length;
  }
  placePlain(row.slice(lastIndex));
  // Trailing escapes (e.g. a reset) attach to the last written cell so style
  // does not bleed past it.
  if (pending && last >= 0) {
    cells[last] += pending;
  }
  return cells;
}

/** Build the full-screen grid from rows, padding or truncating to `height`. */
export function buildGrid(rows: readonly string[], cols: number, height: number): Grid {
  const grid: Grid = [];
  for (let r = 0; r < height; r++) {
    grid.push(layoutRow(rows[r] ?? '', cols));
  }
  return grid;
}

/**
 * The ANSI writes for a full repaint: every row of `next` is rewritten in full
 * from column 1, every frame, regardless of `prev`. A row is written whole so its
 * styling (ANSI is cumulative across a row) is always re-established in order; a
 * partial-cell write would drop the colour state set by earlier cells. Writing
 * the full row's cells, including trailing blanks, overwrites any stale content
 * without relying on the terminal to clear it. The previous grid is no longer
 * consulted: tmux reflows the grid behind our back on resize and on entering
 * copy-mode, so a row our model believes unchanged can still hold orphaned cells.
 * Repainting every cell overwrites them; `_prev` is kept only for call-site
 * compatibility.
 */
export function diffToWrites(_prev: Grid | null, next: Grid): string {
  let out = '';
  for (let r = 0; r < next.length; r++) {
    out += cursorAt(r + 1, 1) + rowText(next[r] ?? []);
  }
  return out;
}

function rowText(row: readonly Cell[]): string {
  return row.join('');
}

/** The visible text of each grid row, trailing blanks trimmed. For assertions. */
export function gridToLines(grid: Grid): string[] {
  return grid.map((row) => row.join('').replace(/\s+$/, ''));
}
