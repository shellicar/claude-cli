import { disableAutowrap, disableMouse, enableAutowrap, enableMouse, hideCursor, showCursor, syncEnd, syncStart } from '@shellicar/claude-core/ansi';
import type { Screen } from '@shellicar/claude-core/screen';
import type { TerminalState } from '../model/TerminalState.js';
import { buildGrid, diffToWrites, type Grid } from './ScreenBuffer.js';

/**
 * Owns the Screen and a cell-grid back buffer. Rows in, stdout writes out. Pushes
 * resize into TerminalState so the rest of the system reads dimensions from a
 * store. The 300ms resize debounce stays here: mid-resize paints are suppressed
 * by #resizing, and after the debounce setSize fires and the subscribed ViewHost
 * re-renders.
 */
export class TerminalRenderer implements Disposable {
  readonly #screen: Screen;
  readonly #cleanupResize: () => void;
  #resizing = false;
  #resizeTimer: ReturnType<typeof setTimeout> | undefined;
  #previous: Grid | null = null;
  #prevCols = 0;
  #prevRows = 0;

  public constructor(screen: Screen, terminalState: TerminalState) {
    this.#screen = screen;
    terminalState.setSize(screen.columns, screen.rows);
    this.#cleanupResize = this.#screen.onResize(() => {
      this.#resizing = true;
      clearTimeout(this.#resizeTimer);
      this.#resizeTimer = setTimeout(() => {
        this.#resizing = false;
        terminalState.setSize(screen.columns, screen.rows);
      }, 300);
    });
  }

  public [Symbol.dispose](): void {
    this.exit();
  }

  public enter(): void {
    this.#screen.enterAltBuffer();
    this.#screen.write(enableMouse);
    // Fresh buffer: nothing on screen yet, so the next paint must draw in full.
    this.#previous = null;
  }

  public exit(): void {
    this.#cleanupResize();
    clearTimeout(this.#resizeTimer);
    this.#screen.write(disableMouse + showCursor);
    this.#screen.exitAltBuffer();
  }

  /**
   * Full-frame paint inside the alt buffer. The rows are laid into a cell grid;
   * only the cells that differ from the previous frame are written, each at an
   * absolute cursor position with autowrap disabled. The grid is the source of
   * truth and every cell is addressed by coordinate, so nothing depends on the
   * terminal advancing the cursor or wrapping at the margin — the ghost class (a
   * stranded physical line still showing a previous frame) cannot occur.
   */
  public paint(rows: readonly string[]): void {
    if (this.#resizing) {
      return;
    }
    const cols = this.#screen.columns;
    const height = this.#screen.rows;
    if (cols !== this.#prevCols || height !== this.#prevRows) {
      this.#previous = null;
      this.#prevCols = cols;
      this.#prevRows = height;
    }
    const next = buildGrid(rows, cols, height);
    const body = diffToWrites(this.#previous, next);
    this.#previous = next;
    if (body.length === 0) {
      return;
    }
    this.#screen.write(syncStart + hideCursor + disableAutowrap + body + enableAutowrap + syncEnd);
  }

  /** Write outside the alt buffer (scroll persistence), then re-enter alt. */
  public writeToScroll(content: string): void {
    this.#screen.exitAltBuffer();
    this.#screen.write(content);
    this.#screen.enterAltBuffer();
    // The alt buffer was left and re-entered, so our model of it is stale.
    this.#previous = null;
  }
}
