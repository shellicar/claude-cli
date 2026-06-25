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

  /**
   * Full-frame paint inside the alt buffer. Each row is written at an absolute
   * cursor position rather than relying on a trailing newline to advance one
   * physical line. That keeps one logical row on one physical line regardless of
   * the terminal's last-column wrap behaviour, which is what eliminates the
   * ghost-text defect: a full-width row followed by a bare `\n` could otherwise
   * strand a physical line that kept the previous frame's content.
   */
  public paint(rows: readonly string[]): void {
    if (this.#resizing) {
      return;
    }
    let out = syncStart + hideCursor;
    for (let i = 0; i < rows.length; i++) {
      out += `${cursorAt(i + 1, 1)}${clearLine}${rows[i] ?? ''}`;
    }
    out += clearDown;
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
