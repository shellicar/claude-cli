import { clearDown, clearLine, cursorAt, hideCursor, showCursor, syncEnd, syncStart } from '@shellicar/claude-core/ansi';
import type { Screen } from '@shellicar/claude-core/screen';
import type { TerminalState } from '../model/TerminalState.js';

/**
 * Owns the Screen. Rows in, stdout writes out. Pushes resize into TerminalState
 * so the rest of the system reads dimensions from a store. The 300ms resize
 * debounce stays here: mid-resize paints are suppressed by #resizing, and after
 * the debounce setSize fires and the subscribed ViewHost re-renders.
 */
export class TerminalRenderer implements Disposable {
  readonly #screen: Screen;
  readonly #cleanupResize: () => void;
  #resizing = false;
  #resizeTimer: ReturnType<typeof setTimeout> | undefined;

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
  }

  public exit(): void {
    this.#cleanupResize();
    clearTimeout(this.#resizeTimer);
    this.#screen.write(showCursor);
    this.#screen.exitAltBuffer();
  }

  /** Full-frame paint inside the alt buffer. Byte-for-byte equal to AppLayout.render's write step. */
  public paint(rows: readonly string[]): void {
    if (this.#resizing) {
      return;
    }
    let out = syncStart + hideCursor;
    out += cursorAt(1, 1);
    for (let i = 0; i < rows.length - 1; i++) {
      out += `\r${clearLine}${rows[i] ?? ''}\n`;
    }
    out += clearDown;
    const lastRow = rows[rows.length - 1];
    if (lastRow !== undefined) {
      out += `\r${clearLine}${lastRow}`;
    }
    out += syncEnd;
    this.#screen.write(out);
  }

  /** Write outside the alt buffer (scroll persistence), then re-enter alt. */
  public writeToScroll(content: string): void {
    this.#screen.exitAltBuffer();
    this.#screen.write(content);
    this.#screen.enterAltBuffer();
  }
}
