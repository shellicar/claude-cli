import type { KeyAction } from '@shellicar/claude-core/input';
import stringWidth from 'string-width';

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Returns the largest code-unit offset in `line` such that the visual width
 * of `line.slice(0, offset)` does not exceed `targetVisual` columns.
 * Clamps to `line.length` when `targetVisual` exceeds the line's full width.
 */
function colFromVisual(line: string, targetVisual: number): number {
  if (targetVisual <= 0) {
    return 0;
  }
  let w = 0;
  for (const { segment, index } of graphemeSegmenter.segment(line)) {
    const sw = stringWidth(segment);
    if (w + sw > targetVisual) {
      return index;
    }
    w += sw;
  }
  return line.length;
}

/**
 * Returns the code-unit position of the grapheme boundary immediately before
 * `pos`. Moves back by one grapheme cluster, so moving left through a
 * 2-code-unit emoji jumps to its start rather than landing mid-surrogate.
 */
function graphemeBoundaryBefore(line: string, pos: number): number {
  let boundary = 0;
  for (const { segment, index } of graphemeSegmenter.segment(line)) {
    const end = index + segment.length;
    if (end >= pos) {
      return index;
    }
    boundary = index;
  }
  return boundary;
}

/**
 * Returns the code-unit position after the grapheme cluster that starts at
 * `pos`. Advances by one grapheme cluster, so moving right through a
 * 2-code-unit emoji jumps to the character after it.
 */
function graphemeBoundaryAfter(line: string, pos: number): number {
  for (const { segment, index } of graphemeSegmenter.segment(line)) {
    if (index === pos) {
      return index + segment.length;
    }
  }
  // Fallback: advance one code unit (should not happen with well-formed text).
  return pos + 1;
}

type EditorStateInit = {
  lines: string[];
  cursorLine: number;
  cursorCol: number;
};

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
   * Construct the editor, optionally with explicit starting state.
   * Used by tests to express scenarios directly and by any future code
   * that needs to restore saved state.
   */
  public constructor(initial?: EditorStateInit) {
    if (initial) {
      this.#lines = [...initial.lines];
      this.#cursorLine = initial.cursorLine;
      this.#cursorCol = initial.cursorCol;
    }
  }

  /**
   * The lines of text. Mutations go through `handleKey`, `reset`, or the
   * constructor's `initial` argument. AppLayout uses this for rendering only.
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
          const line = this.#lines[this.#cursorLine] ?? '';
          this.#cursorCol = graphemeBoundaryBefore(line, this.#cursorCol);
        } else if (this.#cursorLine > 0) {
          this.#cursorLine--;
          this.#cursorCol = (this.#lines[this.#cursorLine] ?? '').length;
        }
        return true;
      }
      case 'right': {
        const line = this.#lines[this.#cursorLine] ?? '';
        if (this.#cursorCol < line.length) {
          this.#cursorCol = graphemeBoundaryAfter(line, this.#cursorCol);
        } else if (this.#cursorLine < this.#lines.length - 1) {
          this.#cursorLine++;
          this.#cursorCol = 0;
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

  /**
   * Move the caret up by one visual row. Within a wrapped logical line this
   * stays on the same `#lines` index but repositions `#cursorCol`. At the
   * first visual row of a logical line, moves to the last visual row of the
   * previous logical line. Returns true (key is always consumed).
   */
  public moveUpVisual(cols: number, prefixWidth: number): boolean {
    const line = this.#lines[this.#cursorLine] ?? '';
    const visualPos = prefixWidth + stringWidth(line.slice(0, this.#cursorCol));
    const rowInLine = Math.floor(visualPos / cols);
    const colInRow = visualPos % cols;

    if (rowInLine > 0) {
      const targetPos = (rowInLine - 1) * cols + colInRow;
      this.#cursorCol = colFromVisual(line, Math.max(0, targetPos - prefixWidth));
      return true;
    }

    if (this.#cursorLine === 0) {
      return true;
    }

    this.#cursorLine--;
    const prevLine = this.#lines[this.#cursorLine] ?? '';
    const prevTotalVisual = prefixWidth + stringWidth(prevLine);
    const prevRowCount = Math.max(1, Math.ceil(prevTotalVisual / cols));
    const prevTargetPos = Math.min((prevRowCount - 1) * cols + colInRow, prevTotalVisual);
    this.#cursorCol = colFromVisual(prevLine, Math.max(0, prevTargetPos - prefixWidth));
    return true;
  }

  /**
   * Move the caret down by one visual row. Within a wrapped logical line this
   * stays on the same `#lines` index but repositions `#cursorCol`. At the
   * last visual row of a logical line, moves to the first visual row of the
   * next logical line. Returns true (key is always consumed).
   */
  public moveDownVisual(cols: number, prefixWidth: number): boolean {
    const line = this.#lines[this.#cursorLine] ?? '';
    const visualPos = prefixWidth + stringWidth(line.slice(0, this.#cursorCol));
    const rowInLine = Math.floor(visualPos / cols);
    const colInRow = visualPos % cols;
    const totalVisual = prefixWidth + stringWidth(line);
    const totalRows = Math.max(1, Math.ceil(totalVisual / cols));

    if (rowInLine < totalRows - 1) {
      const targetPos = Math.min((rowInLine + 1) * cols + colInRow, totalVisual);
      this.#cursorCol = colFromVisual(line, Math.max(0, targetPos - prefixWidth));
      return true;
    }

    if (this.#cursorLine >= this.#lines.length - 1) {
      return true;
    }

    this.#cursorLine++;
    const nextLine = this.#lines[this.#cursorLine] ?? '';
    this.#cursorCol = colFromVisual(nextLine, Math.max(0, colInRow - prefixWidth));
    return true;
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
