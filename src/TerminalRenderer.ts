import stringWidth from 'string-width';
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
    // Trim trailing empty rows from the Viewport-padded frame. Padding is correct
    // for Viewport's contract but would cause the Renderer to write screenRows rows
    // from wherever the cursor currently is, scrolling the terminal unnecessarily.
    let trimEnd = frame.rows.length;
    while (trimEnd > 1 && frame.rows[trimEnd - 1] === '') {
      trimEnd--;
    }
    const renderFrame =
      trimEnd === frame.rows.length
        ? frame
        : {
            rows: frame.rows.slice(0, trimEnd),
            visibleCursorRow: Math.min(frame.visibleCursorRow, trimEnd - 1),
            visibleCursorCol: frame.visibleCursorCol,
          };
    let out = syncStart + hideCursor;
    out += cursorUp(this.lastVisibleCursorRow);
    out += this.buildZoneOutput(renderFrame);
    out += showCursor + syncEnd;
    this.zoneHeight = renderFrame.rows.length;
    // Track the actual visual cursor row offset from zone top. Rows that are
    // exactly `columns` wide wrap the cursor to the next row, so the visual
    // offset is greater than the logical row index when any row above the
    // cursor wraps.
    const wrapAboveCursor = renderFrame.rows.slice(0, renderFrame.visibleCursorRow).reduce((sum, row) => sum + Math.floor(stringWidth(row) / this.screen.columns), 0);
    this.lastVisibleCursorRow = renderFrame.visibleCursorRow + wrapAboveCursor;
    this.lastFrame = frame;
    this.screen.write(out);
  }

  /**
   * Writes a history line above the zone and resets cursor tracking so the
   * CALLER can re-render the zone from the current position. Does NOT
   * re-render the zone itself. Use this when the caller will supply a fresh
   * frame (e.g. Terminal.writeHistory → renderZone).
   */
  public writeHistoryLine(line: string): void {
    const out = cursorUp(this.lastVisibleCursorRow) + '\r' + clearLine + line + '\n';
    this.lastVisibleCursorRow = 0;
    this.screen.write(out);
  }

  /** @deprecated Prefer writeHistoryLine + external render for fresh frames. */
  public writeHistory(line: string): void {
    let out = cursorUp(this.lastVisibleCursorRow);
    out += '\r' + line + '\n';
    this.screen.write(out);
    if (this.lastFrame !== null) {
      // Trim trailing empty rows so the re-rendered zone fits after the zone shifts
      // down by one row. Viewport pads frames to screenRows; those empty rows are
      // correct for render() but cause scrollback violations here.
      let trimEnd = this.lastFrame.rows.length;
      while (trimEnd > 1 && this.lastFrame.rows[trimEnd - 1] === '') {
        trimEnd--;
      }
      const trimmedRows = this.lastFrame.rows.slice(0, trimEnd);
      const trimmedFrame = {
        rows: trimmedRows,
        visibleCursorRow: Math.min(this.lastFrame.visibleCursorRow, trimmedRows.length - 1),
        visibleCursorCol: this.lastFrame.visibleCursorCol,
      };
      this.screen.write(this.buildZoneOutput(trimmedFrame));
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
