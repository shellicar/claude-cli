export interface ViewportResult {
  rows: string[];
  visibleCursorRow: number;
  visibleCursorCol: number;
}

export class Viewport {
  private scrollOffset = 0;

  public resolve(buffer: string[], screenRows: number, cursorRow: number, cursorCol: number): ViewportResult {
    // Cap scrollOffset after a potential resize
    this.scrollOffset = Math.min(this.scrollOffset, Math.max(0, buffer.length - screenRows));

    // Cursor chasing
    if (cursorRow < this.scrollOffset) {
      this.scrollOffset = cursorRow;
    } else if (cursorRow >= this.scrollOffset + screenRows) {
      this.scrollOffset = cursorRow - screenRows + 1;
    }

    const slice = buffer.slice(this.scrollOffset, this.scrollOffset + screenRows);
    const padding = screenRows - slice.length;
    const rows = padding > 0 ? [...slice, ...Array(padding).fill('')] : slice;

    return {
      rows,
      visibleCursorRow: cursorRow - this.scrollOffset,
      visibleCursorCol: cursorCol,
    };
  }
}
