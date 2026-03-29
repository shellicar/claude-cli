export interface HistoryFrame {
  rows: string[];
  totalLines: number;
  visibleStart: number;
}

export class HistoryViewport {
  private scrollOffset = 0;
  private _mode: 'live' | 'history' = 'live';
  private lastViewportRows = 0;
  private lastBufferLength = 0;

  public get mode(): 'live' | 'history' {
    return this._mode;
  }

  /**
   * Resolve the history buffer into a frame for rendering.
   * In live mode, auto-follows the bottom.
   * In history mode, scrollOffset is pinned.
   * Content is bottom-aligned (top-padded) when buffer < viewport rows.
   */
  public resolve(buffer: string[], rows: number): HistoryFrame {
    this.lastViewportRows = rows;
    this.lastBufferLength = buffer.length;

    if (rows <= 0) {
      return { rows: [], totalLines: buffer.length, visibleStart: 0 };
    }

    if (buffer.length === 0) {
      return { rows: Array(rows).fill(''), totalLines: 0, visibleStart: 0 };
    }

    if (this._mode === 'live') {
      this.scrollOffset = Math.max(0, buffer.length - rows);
    } else {
      // Cap to valid range (buffer may have grown since last scroll)
      this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, buffer.length - rows));
    }

    const slice = buffer.slice(this.scrollOffset, this.scrollOffset + rows);

    // Top-pad: empty rows first, content at bottom of region.
    // Keeps the most recent history adjacent to the zone.
    const padding = rows - slice.length;
    const result = padding > 0 ? [...Array(padding).fill(''), ...slice] : slice;

    return {
      rows: result,
      totalLines: buffer.length,
      visibleStart: this.scrollOffset,
    };
  }

  /**
   * Scroll up by one page (historyRows). Enters history mode.
   * First call snaps scrollOffset to current live position before scrolling.
   */
  public pageUp(): void {
    if (this.lastViewportRows <= 0 || this.lastBufferLength === 0) {
      return;
    }
    if (this._mode === 'live') {
      this.scrollOffset = Math.max(0, this.lastBufferLength - this.lastViewportRows);
    }
    this._mode = 'history';
    this.scrollOffset = Math.max(0, this.scrollOffset - this.lastViewportRows);
  }

  /**
   * Scroll down by one page. Returns to live if scrolled to bottom.
   */
  public pageDown(): void {
    if (this._mode !== 'history') {
      return;
    }
    const maxOffset = Math.max(0, this.lastBufferLength - this.lastViewportRows);
    this.scrollOffset = Math.min(this.scrollOffset + this.lastViewportRows, maxOffset);
    if (this.scrollOffset >= maxOffset) {
      this._mode = 'live';
    }
  }

  /**
   * Scroll up by one line. Enters history mode.
   */
  public lineUp(): void {
    if (this.lastViewportRows <= 0 || this.lastBufferLength === 0) {
      return;
    }
    if (this._mode === 'live') {
      this.scrollOffset = Math.max(0, this.lastBufferLength - this.lastViewportRows);
    }
    this._mode = 'history';
    this.scrollOffset = Math.max(0, this.scrollOffset - 1);
  }

  /**
   * Scroll down by one line. Returns to live if scrolled to bottom.
   */
  public lineDown(): void {
    if (this._mode !== 'history') {
      return;
    }
    const maxOffset = Math.max(0, this.lastBufferLength - this.lastViewportRows);
    this.scrollOffset = Math.min(this.scrollOffset + 1, maxOffset);
    if (this.scrollOffset >= maxOffset) {
      this._mode = 'live';
    }
  }

  /**
   * Return to live mode. Next resolve() will auto-follow bottom.
   */
  public returnToLive(): void {
    this._mode = 'live';
  }
}
