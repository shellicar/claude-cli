import type { Screen } from './Screen.js';
import type { ViewportResult } from './Viewport.js';

const ESC = '\x1B[';
const cursorUp = (n: number) => (n > 0 ? `${ESC}${n}A` : '');
const cursorTo = (col: number) => `${ESC}${col + 1}G`;
const clearLine = `${ESC}2K`;
const clearDown = `${ESC}J`;
const showCursor = `${ESC}?25h`;
const hideCursor = `${ESC}?25l`;
const syncStart = '\x1B[?2026h';
const syncEnd = '\x1B[?2026l';

export class Renderer {
  public zoneHeight = 0;
  private lastVisibleCursorRow = 0;
  private lastFrame: ViewportResult | null = null;

  public constructor(private readonly screen: Screen) {}

  public render(frame: ViewportResult): void {
    let out = syncStart + hideCursor;
    out += cursorUp(this.lastVisibleCursorRow);
    out += this.buildZoneOutput(frame);
    out += showCursor + syncEnd;
    this.zoneHeight = frame.rows.length;
    this.lastVisibleCursorRow = frame.visibleCursorRow;
    this.lastFrame = frame;
    this.screen.write(out);
  }

  public writeHistory(line: string): void {
    let out = cursorUp(this.lastVisibleCursorRow);
    out += '\r' + line + '\n';
    this.screen.write(out);
    if (this.lastFrame !== null) {
      this.screen.write(this.buildZoneOutput(this.lastFrame));
    }
  }

  private buildZoneOutput(frame: ViewportResult): string {
    let out = '';
    // Write all rows except the last, each followed by \n to advance the cursor.
    for (let i = 0; i < frame.rows.length - 1; i++) {
      out += '\r' + clearLine + frame.rows[i] + '\n';
    }
    // clearDown here clears leftover rows from a taller previous frame.
    // It must come before the last row write so the last row's content is not erased.
    out += clearDown;
    // Write the last row without \n to avoid a scrollback violation on a full screen.
    const lastRow = frame.rows[frame.rows.length - 1];
    if (lastRow !== undefined) {
      out += '\r' + clearLine + lastRow;
    }
    const rowsFromBottom = frame.rows.length - 1 - frame.visibleCursorRow;
    out += cursorUp(rowsFromBottom);
    out += cursorTo(frame.visibleCursorCol);
    return out;
  }
}
