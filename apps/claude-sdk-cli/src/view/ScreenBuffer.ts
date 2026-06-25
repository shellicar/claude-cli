import { cursorAt } from '@shellicar/claude-core/ansi';
import stringWidth from 'string-width';

/**
 * The renderer's model of the screen as a grid of cells. Each cell holds the
 * text printed for one column: a grapheme (optionally prefixed with the ANSI SGR
 * that styles it), a single space for a blank, or an empty string for the
 * trailing column of a wide grapheme.
 *
 * Rows of styled text are laid into a fixed cols x height grid. paint diffs the
 * desired grid against what is on screen and writes only the changed cells, each
 * at an absolute cursor position. Nothing depends on the terminal advancing the
 * cursor or wrapping at the margin, so the ghost class — a stranded physical line
 * still holding a previous frame's content — cannot occur: the grid is the source
 * of truth and every cell is addressed by coordinate.
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
 * The ANSI writes needed to turn `prev` into `next`. A row that changed at all is
 * rewritten in full from column 1, so its styling (ANSI is cumulative across a
 * row) is always re-established in order; a partial-cell write would drop the
 * colour state set by earlier cells. Writing the full row's cells, including
 * trailing blanks, also overwrites any stale content without relying on the
 * terminal to clear it. Each row is positioned absolutely; a null `prev` writes
 * every row.
 */
export function diffToWrites(prev: Grid | null, next: Grid): string {
  let out = '';
  for (let r = 0; r < next.length; r++) {
    const prevRow = prev?.[r];
    const row = next[r];
    if (prevRow && rowText(prevRow) === rowText(row)) {
      continue;
    }
    out += cursorAt(r + 1, 1) + rowText(row);
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
