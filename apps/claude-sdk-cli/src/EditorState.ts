import type { KeyAction } from '@shellicar/claude-core/input';

/**
 * Pure editor state — lines of text and cursor position.
 * No rendering, no I/O.
 *
 * `handleKey` owns all text-editing transitions. `ctrl+enter` (submit) is
 * intentionally absent — it involves attachments and a promise resolve that
 * live in AppLayout.
 */
export class EditorState {
  #lines: string[] = [''];
  #cursorLine = 0;
  #cursorCol = 0;

  /**
   * The lines of text. Read-only: all mutations go through `handleKey` or
   * `reset`. AppLayout uses this for rendering only.
   */
  public get lines(): readonly string[] {
    return this.#lines;
  }

  public get cursorLine(): number {
    return this.#cursorLine;
  }

  public get cursorCol(): number {
    return this.#cursorCol;
  }

  /** Full text content — all lines joined by newline. */
  public get text(): string {
    return this.#lines.join('\n');
  }

  /** Reset to a single empty line with cursor at the origin. */
  public reset(): void {
    this.#lines = [''];
    this.#cursorLine = 0;
    this.#cursorCol = 0;
  }

  /**
   * Handle an editor key. Returns true if the key was consumed (caller should
   * schedule a re-render). Returns false for `ctrl+enter` and any key not
   * recognised here — the caller handles those itself.
   */
  public handleKey(key: KeyAction): boolean {
    switch (key.type) {
      case 'enter': {
        const cur = this.#lines[this.#cursorLine] ?? '';
        const before = cur.slice(0, this.#cursorCol);
        const after = cur.slice(this.#cursorCol);
        this.#lines[this.#cursorLine] = before;
        this.#lines.splice(this.#cursorLine + 1, 0, after);
        this.#cursorLine++;
        this.#cursorCol = 0;
        return true;
      }
      case 'backspace': {
        if (this.#cursorCol > 0) {
          const line = this.#lines[this.#cursorLine] ?? '';
          this.#lines[this.#cursorLine] = line.slice(0, this.#cursorCol - 1) + line.slice(this.#cursorCol);
          this.#cursorCol--;
        } else if (this.#cursorLine > 0) {
          const prev = this.#lines[this.#cursorLine - 1] ?? '';
          const curr = this.#lines[this.#cursorLine] ?? '';
          this.#lines.splice(this.#cursorLine, 1);
          this.#cursorLine--;
          this.#cursorCol = prev.length;
          this.#lines[this.#cursorLine] = prev + curr;
        }
        return true;
      }
      case 'delete': {
        const line = this.#lines[this.#cursorLine] ?? '';
        if (this.#cursorCol < line.length) {
          this.#lines[this.#cursorLine] = line.slice(0, this.#cursorCol) + line.slice(this.#cursorCol + 1);
        } else if (this.#cursorLine < this.#lines.length - 1) {
          const next = this.#lines[this.#cursorLine + 1] ?? '';
          this.#lines.splice(this.#cursorLine + 1, 1);
          this.#lines[this.#cursorLine] = line + next;
        }
        return true;
      }
      case 'ctrl+backspace': {
        if (this.#cursorCol === 0) {
          if (this.#cursorLine > 0) {
            const prev = this.#lines[this.#cursorLine - 1] ?? '';
            const curr = this.#lines[this.#cursorLine] ?? '';
            this.#lines.splice(this.#cursorLine, 1);
            this.#cursorLine--;
            this.#cursorCol = prev.length;
            this.#lines[this.#cursorLine] = prev + curr;
          }
        } else {
          const line = this.#lines[this.#cursorLine] ?? '';
          const newCol = this.#wordStartLeft(line, this.#cursorCol);
          this.#lines[this.#cursorLine] = line.slice(0, newCol) + line.slice(this.#cursorCol);
          this.#cursorCol = newCol;
        }
        return true;
      }
      case 'ctrl+delete': {
        const line = this.#lines[this.#cursorLine] ?? '';
        if (this.#cursorCol === line.length) {
          if (this.#cursorLine < this.#lines.length - 1) {
            const next = this.#lines[this.#cursorLine + 1] ?? '';
            this.#lines.splice(this.#cursorLine + 1, 1);
            this.#lines[this.#cursorLine] = line + next;
          }
        } else {
          const newCol = this.#wordEndRight(line, this.#cursorCol);
          this.#lines[this.#cursorLine] = line.slice(0, this.#cursorCol) + line.slice(newCol);
        }
        return true;
      }
      case 'ctrl+k': {
        const line = this.#lines[this.#cursorLine] ?? '';
        if (this.#cursorCol < line.length) {
          this.#lines[this.#cursorLine] = line.slice(0, this.#cursorCol);
        } else if (this.#cursorLine < this.#lines.length - 1) {
          const next = this.#lines[this.#cursorLine + 1] ?? '';
          this.#lines.splice(this.#cursorLine + 1, 1);
          this.#lines[this.#cursorLine] = line + next;
        }
        return true;
      }
      case 'ctrl+u': {
        const line = this.#lines[this.#cursorLine] ?? '';
        this.#lines[this.#cursorLine] = line.slice(this.#cursorCol);
        this.#cursorCol = 0;
        return true;
      }
      case 'left': {
        if (this.#cursorCol > 0) {
          this.#cursorCol--;
        } else if (this.#cursorLine > 0) {
          this.#cursorLine--;
          this.#cursorCol = (this.#lines[this.#cursorLine] ?? '').length;
        }
        return true;
      }
      case 'right': {
        const line = this.#lines[this.#cursorLine] ?? '';
        if (this.#cursorCol < line.length) {
          this.#cursorCol++;
        } else if (this.#cursorLine < this.#lines.length - 1) {
          this.#cursorLine++;
          this.#cursorCol = 0;
        }
        return true;
      }
      case 'up': {
        if (this.#cursorLine > 0) {
          this.#cursorLine--;
          const newLine = this.#lines[this.#cursorLine] ?? '';
          this.#cursorCol = Math.min(this.#cursorCol, newLine.length);
        }
        return true;
      }
      case 'down': {
        if (this.#cursorLine < this.#lines.length - 1) {
          this.#cursorLine++;
          const newLine = this.#lines[this.#cursorLine] ?? '';
          this.#cursorCol = Math.min(this.#cursorCol, newLine.length);
        }
        return true;
      }
      case 'home': {
        this.#cursorCol = 0;
        return true;
      }
      case 'end': {
        this.#cursorCol = (this.#lines[this.#cursorLine] ?? '').length;
        return true;
      }
      case 'ctrl+home': {
        this.#cursorLine = 0;
        this.#cursorCol = 0;
        return true;
      }
      case 'ctrl+end': {
        this.#cursorLine = this.#lines.length - 1;
        this.#cursorCol = (this.#lines[this.#cursorLine] ?? '').length;
        return true;
      }
      case 'ctrl+left': {
        const line = this.#lines[this.#cursorLine] ?? '';
        this.#cursorCol = this.#wordStartLeft(line, this.#cursorCol);
        return true;
      }
      case 'ctrl+right': {
        const line = this.#lines[this.#cursorLine] ?? '';
        this.#cursorCol = this.#wordEndRight(line, this.#cursorCol);
        return true;
      }
      case 'char': {
        const line = this.#lines[this.#cursorLine] ?? '';
        this.#lines[this.#cursorLine] = line.slice(0, this.#cursorCol) + key.value + line.slice(this.#cursorCol);
        this.#cursorCol += key.value.length;
        return true;
      }
      default:
        return false;
    }
  }

  /** Returns the column index of the start of the word to the left of col. */
  #wordStartLeft(line: string, col: number): number {
    let c = col;
    while (c > 0 && line[c - 1] === ' ') {
      c--;
    }
    while (c > 0 && line[c - 1] !== ' ') {
      c--;
    }
    return c;
  }

  /** Returns the column index of the end of the word to the right of col. */
  #wordEndRight(line: string, col: number): number {
    let c = col;
    while (c < line.length && line[c] === ' ') {
      c++;
    }
    while (c < line.length && line[c] !== ' ') {
      c++;
    }
    return c;
  }
}
