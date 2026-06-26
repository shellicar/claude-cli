import type { Screen } from '@shellicar/claude-core/screen';
import stringWidth from 'string-width';

/**
 * Last-column autowrap semantics. The whole ghost-text experiment turns on this
 * one terminal behaviour, so it is a first-class, characterised option rather
 * than a hidden assumption.
 *
 * - `deferred` is the documented VT100 / xterm behaviour (DEC AutoWrap, the
 *   "wrapnext" / pending-wrap flag): a glyph written into the last column sets a
 *   pending-wrap flag but does NOT move the cursor. The wrap is performed only
 *   when the next glyph arrives. A linefeed received while the flag is pending
 *   is a single downward advance that clears the flag — it does not consume the
 *   pending wrap as a second advance. (xterm `ctlseqs`, DEC VT510 manual.)
 * - `immediate` is the divergent semantic some terminals exhibit: the cursor
 *   moves to the first column of the next row the instant the last column is
 *   filled, with no deferred pending-wrap.
 *
 * Both are real, documented behaviours; `deferred` is the default because it is
 * the one most modern terminals implement.
 */
export type LastColumnWrap = 'deferred' | 'immediate';

export interface VirtualScreenOptions {
  columns: number;
  rows: number;
  lastColumnWrap?: LastColumnWrap;
}

const ESC = '\x1B';
const BEL = '\x07';
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// A single CSI sequence at the start of the slice: ESC [ <params> <final>.
// Params are digits, ';' and the private-mode '?'. The final is one letter.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences requires \x1b
const CSI_RE = /^\x1B\[[0-9;?]*[A-Za-z]/;

const clamp = (value: number, lo: number, hi: number): number => Math.min(Math.max(value, lo), hi);

/**
 * A minimal terminal-grid emulator: just the ANSI operations `TerminalRenderer.paint`
 * emits (absolute cursor positioning, erase-line, erase-display, CR, LF, SGR and
 * private-mode toggles it can ignore) plus last-column autowrap. It is not a full
 * xterm — it models exactly what is needed to observe what `paint`'s output does
 * to a real terminal's grid, and no more.
 *
 * It implements `Screen` so a real `TerminalRenderer` can be constructed against
 * it with no mocking of the unit under test.
 */
export class VirtualScreen implements Screen {
  readonly #columns: number;
  readonly #rows: number;
  readonly #wrapMode: LastColumnWrap;
  #autowrap = true;
  #grid: string[][];
  #row = 0;
  #col = 0;
  #pendingWrap = false;

  public constructor(options: VirtualScreenOptions) {
    this.#columns = options.columns;
    this.#rows = options.rows;
    this.#wrapMode = options.lastColumnWrap ?? 'deferred';
    this.#grid = this.#blankGrid();
  }

  public get columns(): number {
    return this.#columns;
  }

  public get rows(): number {
    return this.#rows;
  }

  public get cursorRow(): number {
    return this.#row;
  }

  public get cursorCol(): number {
    return this.#col;
  }

  public get pendingWrap(): boolean {
    return this.#pendingWrap;
  }

  /** The visible text of one grid row, with trailing blanks removed. */
  public lineAt(row: number): string {
    return this.#grid[row].join('').replace(/\s+$/, '');
  }

  /** Every grid row as text, top to bottom. */
  public lines(): string[] {
    return this.#grid.map((_, row) => this.lineAt(row));
  }

  public write(data: string): void {
    let i = 0;
    while (i < data.length) {
      const ch = data[i];
      if (ch === ESC) {
        const match = CSI_RE.exec(data.slice(i));
        if (match) {
          this.#handleCsi(match[0]);
          i += match[0].length;
          continue;
        }
        // A lone ESC with no recognised CSI: drop the ESC and continue.
        i += 1;
        continue;
      }
      if (ch === '\r') {
        this.#carriageReturn();
        i += 1;
        continue;
      }
      if (ch === '\n') {
        this.#lineFeed();
        i += 1;
        continue;
      }
      if (ch === BEL) {
        i += 1;
        continue;
      }
      // A run of printable text up to the next control or escape.
      let j = i;
      while (j < data.length && data[j] !== ESC && data[j] !== '\r' && data[j] !== '\n' && data[j] !== BEL) {
        j++;
      }
      this.#writeText(data.slice(i, j));
      i = j;
    }
  }

  public onResize(_cb: (columns: number, rows: number) => void): () => void {
    return () => {};
  }

  public enterAltBuffer(): void {}

  public exitAltBuffer(): void {}

  #blankGrid(): string[][] {
    return Array.from({ length: this.#rows }, () => Array.from({ length: this.#columns }, () => ' '));
  }

  #handleCsi(seq: string): void {
    const final = seq[seq.length - 1];
    const params = seq.slice(2, seq.length - 1);
    // Private-mode sequences (ESC [ ? ... h / l). Autowrap (DECAWM, ?7) is
    // modelled because paint toggles it; the rest (synchronized output, cursor
    // visibility) carry no grid effect here.
    if (params.startsWith('?')) {
      if (params === '?7') {
        this.#autowrap = final === 'h';
      }
      return;
    }
    switch (final) {
      case 'H': {
        const [r, c] = params.split(';');
        const row = r ? Number.parseInt(r, 10) : 1;
        const col = c ? Number.parseInt(c, 10) : 1;
        this.#row = clamp(row - 1, 0, this.#rows - 1);
        this.#col = clamp(col - 1, 0, this.#columns - 1);
        this.#pendingWrap = false;
        return;
      }
      case 'K':
        this.#eraseLine(params ? Number.parseInt(params, 10) : 0);
        return;
      case 'J':
        this.#eraseDisplay(params ? Number.parseInt(params, 10) : 0);
        return;
      default:
        // SGR ('m') and anything else with no grid effect here.
        return;
    }
  }

  #eraseLine(mode: number): void {
    const row = this.#grid[this.#row];
    const from = mode === 0 ? this.#col : 0;
    const to = mode === 1 ? this.#col : this.#columns - 1;
    for (let c = from; c <= to; c++) {
      row[c] = ' ';
    }
  }

  #eraseDisplay(mode: number): void {
    if (mode === 2) {
      this.#grid = this.#blankGrid();
      return;
    }
    // Mode 0: from the cursor to the end of the screen.
    this.#eraseLine(0);
    for (let r = this.#row + 1; r < this.#rows; r++) {
      this.#grid[r] = Array.from({ length: this.#columns }, () => ' ');
    }
  }

  #carriageReturn(): void {
    this.#col = 0;
    this.#pendingWrap = false;
  }

  #lineFeed(): void {
    this.#advanceRow();
    this.#pendingWrap = false;
  }

  #advanceRow(): void {
    if (this.#row < this.#rows - 1) {
      this.#row += 1;
      return;
    }
    // At the bottom margin: scroll the whole grid up one line.
    this.#grid.shift();
    this.#grid.push(Array.from({ length: this.#columns }, () => ' '));
  }

  #writeText(text: string): void {
    for (const { segment } of segmenter.segment(text)) {
      this.#putGrapheme(segment, Math.max(stringWidth(segment), 0));
    }
  }

  #putGrapheme(grapheme: string, width: number): void {
    if (width === 0) {
      // A zero-width mark combines onto the previously written cell.
      const cell = Math.max(this.#col - 1, 0);
      this.#grid[this.#row][cell] += grapheme;
      return;
    }
    if (this.#pendingWrap) {
      this.#col = 0;
      this.#advanceRow();
      this.#pendingWrap = false;
    }
    this.#grid[this.#row][this.#col] = grapheme;
    for (let k = 1; k < width && this.#col + k < this.#columns; k++) {
      this.#grid[this.#row][this.#col + k] = '';
    }
    this.#col += width;
    if (this.#col < this.#columns) {
      return;
    }
    if (!this.#autowrap) {
      // Autowrap off: the cursor stays at the last column; no wrap, no scroll.
      this.#col = this.#columns - 1;
      return;
    }
    if (this.#wrapMode === 'immediate') {
      this.#col = 0;
      this.#advanceRow();
    } else {
      this.#pendingWrap = true;
      this.#col = this.#columns - 1;
    }
  }
}
