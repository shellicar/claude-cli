import type { Screen } from './Screen.js';
import type { ViewportResult } from './Viewport.js';

const ESC = '\x1B[';
const cursorAt = (row: number, col: number) => `${ESC}${row};${col}H`; // 1-based
const clearLine = `${ESC}2K`;
const clearDown = `${ESC}J`;
const showCursor = `${ESC}?25h`;
const hideCursor = `${ESC}?25l`;
const syncStart = '\x1B[?2026h';
const syncEnd = '\x1B[?2026l';

export class Renderer {
  public constructor(private readonly screen: Screen) {}

  public render(frame: ViewportResult): void {
    // Trim trailing empty rows from the Viewport-padded frame. Padding is correct
    // for Viewport's contract but would cause the Renderer to write screenRows rows
    // unnecessarily.
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
    out += cursorAt(1, 1); // Always top-left in alt buffer

    // Write all rows except last, each followed by \n
    for (let i = 0; i < renderFrame.rows.length - 1; i++) {
      out += '\r' + clearLine + renderFrame.rows[i] + '\n';
    }

    // clearDown clears leftover rows from a taller previous frame
    out += clearDown;

    // Write last row without \n (no scroll)
    const lastRow = renderFrame.rows[renderFrame.rows.length - 1];
    if (lastRow !== undefined) {
      out += '\r' + clearLine + lastRow;
    }

    // Position cursor at absolute coordinates (1-based)
    out += cursorAt(renderFrame.visibleCursorRow + 1, renderFrame.visibleCursorCol + 1);
    out += showCursor + syncEnd;

    this.screen.write(out);
  }
}
