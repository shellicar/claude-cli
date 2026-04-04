import { clearDown, clearLine, cursorAt, hideCursor, showCursor, syncEnd, syncStart } from './ansi.js';
import type { Screen } from './screen.js';
import type { ViewportResult } from './viewport.js';

export class Renderer {
  public constructor(private readonly screen: Screen) {}

  public render(historyRows: string[], zoneFrame: ViewportResult): void {
    // Combine history (top) and zone (bottom) into one buffer
    const combined = [...historyRows, ...zoneFrame.rows];

    // Trim trailing empty rows to avoid writing unnecessary blank rows
    let trimEnd = combined.length;
    while (trimEnd > 1 && combined[trimEnd - 1] === '') {
      trimEnd--;
    }
    const rows = trimEnd === combined.length ? combined : combined.slice(0, trimEnd);

    let out = syncStart + hideCursor;
    out += cursorAt(1, 1); // Always top-left in alt buffer

    // Write all rows except last, each followed by \n
    for (let i = 0; i < rows.length - 1; i++) {
      out += '\r' + clearLine + rows[i] + '\n';
    }

    // clearDown clears leftover rows from a taller previous frame
    out += clearDown;

    // Write last row without \n (no scroll)
    const lastRow = rows[rows.length - 1];
    if (lastRow !== undefined) {
      out += '\r' + clearLine + lastRow;
    }

    // Cursor absolute position: history rows + zone-relative cursor row (1-based)
    const cursorAbsRow = historyRows.length + zoneFrame.visibleCursorRow + 1;
    out += cursorAt(cursorAbsRow, zoneFrame.visibleCursorCol + 1);
    out += showCursor + syncEnd;

    this.screen.write(out);
  }
}
