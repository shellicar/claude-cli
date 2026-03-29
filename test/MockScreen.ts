import type { Screen } from '../src/Screen.js';

export class MockScreen implements Screen {
  public readonly cells: string[][];
  public cursorRow = 0;
  public cursorCol = 0;
  public scrollbackViolations = 0;
  private pendingWrap = false;

  public constructor(
    public readonly columns: number,
    public readonly rows: number,
  ) {
    this.cells = Array.from({ length: rows }, () => new Array<string>(columns).fill(''));
  }

  public write(data: string): void {
    let i = 0;
    while (i < data.length) {
      const ch = data[i];
      if (ch === '\x1B') {
        i++;
        if (i < data.length && data[i] === '[') {
          i++;
          let param = '';
          while (i < data.length && !/[A-Za-z]/.test(data[i] as string)) {
            param += data[i];
            i++;
          }
          if (i < data.length) {
            this.handleCsi(param, data[i] as string);
            i++;
          }
        } else {
          i++;
        }
      } else if (ch === '\r') {
        this.cursorCol = 0;
        this.pendingWrap = false;
        i++;
      } else if (ch === '\n') {
        this.cursorCol = 0;
        this.pendingWrap = false;
        if (this.cursorRow === this.rows - 1) {
          this.scrollbackViolations++;
          this.cells.shift();
          this.cells.push(new Array<string>(this.columns).fill(''));
        } else {
          this.cursorRow++;
        }
        i++;
      } else {
        if (this.pendingWrap) {
          this.pendingWrap = false;
          this.cursorCol = 0;
          if (this.cursorRow < this.rows - 1) {
            this.cursorRow++;
          } else {
            this.scrollbackViolations++;
            this.cells.shift();
            this.cells.push(new Array<string>(this.columns).fill(''));
          }
        }
        this.cells[this.cursorRow][this.cursorCol] = ch;
        this.cursorCol++;
        if (this.cursorCol >= this.columns) {
          this.cursorCol = this.columns - 1;
          this.pendingWrap = true;
        }
        i++;
      }
    }
  }

  private handleCsi(param: string, final: string): void {
    this.pendingWrap = false;
    switch (final) {
      case 'A': {
        const n = parseInt(param || '1', 10);
        this.cursorRow = Math.max(0, this.cursorRow - n);
        break;
      }
      case 'G': {
        const n = parseInt(param || '1', 10);
        this.cursorCol = Math.min(this.columns - 1, Math.max(0, n - 1));
        break;
      }
      case 'K': {
        if (param === '2') {
          for (let c = 0; c < this.columns; c++) {
            this.cells[this.cursorRow][c] = '';
          }
        }
        break;
      }
      case 'H': {
        // Cursor position: ESC[row;colH (1-based, defaults to 1;1)
        const parts = param.split(';');
        const row = parseInt(parts[0] || '1', 10);
        const col = parseInt(parts[1] || '1', 10);
        this.cursorRow = Math.max(0, Math.min(this.rows - 1, row - 1));
        this.cursorCol = Math.max(0, Math.min(this.columns - 1, col - 1));
        break;
      }
      case 'J': {
        for (let r = this.cursorRow; r < this.rows; r++) {
          for (let c = 0; c < this.columns; c++) {
            this.cells[r][c] = '';
          }
        }
        break;
      }
      default:
        break;
    }
  }

  public assertNoScrollbackViolations(): void {
    if (this.scrollbackViolations > 0) {
      throw new Error(`MockScreen: ${this.scrollbackViolations} scrollback violation(s) detected`);
    }
  }

  public getRow(r: number): string {
    const row = this.cells[r];
    let lastNonEmpty = -1;
    for (let c = row.length - 1; c >= 0; c--) {
      if (row[c] !== '') {
        lastNonEmpty = c;
        break;
      }
    }
    return row.slice(0, lastNonEmpty + 1).join('');
  }

  public onResize(_cb: (columns: number, rows: number) => void): () => void {
    return () => {};
  }
}
