import ansiRegex from 'ansi-regex';
import { layoutRow } from '../src/view/ScreenBuffer.js';

/**
 * The glyph occupying a column of a row, measured the way the paint path measures it.
 *
 * Delegates to layoutRow rather than walking the string, because the two disagree wherever
 * a grapheme spans several code points: `⚙️` is one two-column grapheme and 1 + 0 as code
 * points, so counting code points puts every later column out by the difference and the
 * assertion fails against correct production code. A cell carries the styling that travels
 * with it, which is not part of what occupies the column.
 */
export function glyphAtColumn(row: string, column: number): string | undefined {
  return layoutRow(row, column + 1)[column]?.replace(ansiRegex(), '');
}
