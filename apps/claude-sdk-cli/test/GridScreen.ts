import type { Screen } from '@shellicar/claude-core/screen';

// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal control bytes
const CURSOR_RE = /\u001b\[(\d+);1H/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal control bytes
const ANY_ESC_RE = /\u001b\[[0-9;?]*[a-zA-Z]/;
const ALT_ENTER = '\u001b[?1049h';
const CLEAR_DOWN = '\u001b[J';

/** A terminal as a plain cell grid, with a hook to dirty a cell externally. */
export class GridScreen implements Screen {
  public readonly columns: number;
  public readonly rows: number;
  #grid: string[][];

  public constructor(columns: number, rows: number) {
    this.columns = columns;
    this.rows = rows;
    this.#grid = GridScreen.#blank(columns, rows);
  }

  static #blank(cols: number, rows: number): string[][] {
    return Array.from({ length: rows }, () => new Array<string>(cols).fill(' '));
  }

  /** Simulate an external write (tmux/copy-mode) the renderer knows nothing about. */
  public poke(row: number, col: number, ch: string): void {
    this.#grid[row][col] = ch;
  }

  public write(data: string): void {
    if (data.includes(ALT_ENTER)) {
      this.#grid = GridScreen.#blank(this.columns, this.rows);
    }
    let row = 0;
    let col = 0;
    let rest = data;
    while (rest.length > 0) {
      const cursor = CURSOR_RE.exec(rest);
      if (cursor && cursor.index === 0) {
        row = Number(cursor[1]) - 1;
        col = 0;
        rest = rest.slice(cursor[0].length);
        continue;
      }
      if (rest.startsWith(CLEAR_DOWN)) {
        for (let c = col; c < this.columns; c++) {
          this.#grid[row][c] = ' ';
        }
        for (let r = row + 1; r < this.rows; r++) {
          this.#grid[r].fill(' ');
        }
        rest = rest.slice(CLEAR_DOWN.length);
        continue;
      }
      const esc = ANY_ESC_RE.exec(rest);
      if (esc && esc.index === 0) {
        rest = rest.slice(esc[0].length);
        continue;
      }
      // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal control bytes
      const nextEsc = rest.search(/\u001b/);
      const text = nextEsc === -1 ? rest : rest.slice(0, nextEsc);
      rest = nextEsc === -1 ? '' : rest.slice(nextEsc);
      for (const ch of text) {
        if (row >= 0 && row < this.rows && col >= 0 && col < this.columns) {
          this.#grid[row][col] = ch;
        }
        col += 1;
      }
    }
  }

  public visibleLines(): string[] {
    return this.#grid.map((r) => r.join('').replace(/\s+$/, ''));
  }

  public onResize(): () => void {
    return () => {};
  }
  public enterAltBuffer(): void {
    this.write(ALT_ENTER);
  }
  public exitAltBuffer(): void {}
}

