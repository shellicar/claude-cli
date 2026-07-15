import EventEmitter from 'node:events';

type ScrollStateEvents = {
  change: [];
};

/** Lines moved per wheel notch. */
const LINE_STEP = 3;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * The primary transcript's scrollback position, measured as `offset` = lines the
 * viewport bottom sits above the transcript bottom. 0 = pinned to the bottom
 * (live). The user moves it with the wheel / PageUp-Down; nothing auto-snaps.
 *
 * Anchoring to the same content line is the load-bearing rule. The transcript's
 * line count is computed in the view (it depends on width and markdown), so the
 * view reports geometry back each render via measure(). Two cases: when content
 * is appended at the same width the offset grows by the added lines so the same
 * absolute lines stay visible (true hold); when the width changes (resize) the
 * transcript rewraps — the line count changes but the content does not — so the
 * offset is scaled by the rewrap ratio to anchor the viewport to the same line
 * (a narrower window wraps more lines, so the offset must grow to hold place).
 * measure() never emits — it runs inside a render and its result is read by that
 * same render.
 */
export class ScrollState {
  #offset = 0;
  #lastTotal = 0;
  #lastCols = 0;
  #maxOffset = 0;
  #pageSize = 1;
  readonly #emitter = new EventEmitter<ScrollStateEvents>();

  public on<K extends keyof ScrollStateEvents>(event: K, listener: (...args: ScrollStateEvents[K]) => void): void {
    this.#emitter.on(event, listener);
  }

  public off<K extends keyof ScrollStateEvents>(event: K, listener: (...args: ScrollStateEvents[K]) => void): void {
    this.#emitter.off(event, listener);
  }

  public get offset(): number {
    return this.#offset;
  }

  public get isScrolled(): boolean {
    return this.#offset > 0;
  }

  /**
   * Reconcile the stored offset against the transcript geometry for this frame.
   * Called by the view during render; silent (never emits). `total` is the full
   * transcript line count, `visible` the rows available to it, `cols` the width.
   */
  public measure(total: number, visible: number, cols: number): void {
    const maxOffset = Math.max(0, total - visible);
    if (this.#offset > 0 && this.#lastTotal > 0) {
      if (cols === this.#lastCols) {
        // Same width: extra lines are appended content. Grow the offset with
        // them so the same absolute lines stay in view (true hold).
        if (total > this.#lastTotal) {
          this.#offset += total - this.#lastTotal;
        }
      } else {
        // Width changed: the transcript rewrapped — the line count changed but
        // the content did not. Scale the offset by the rewrap ratio so the
        // viewport stays anchored to the same content line.
        this.#offset = Math.round((this.#offset * total) / this.#lastTotal);
      }
    }
    this.#offset = clamp(this.#offset, 0, maxOffset);
    this.#lastTotal = total;
    this.#lastCols = cols;
    this.#maxOffset = maxOffset;
    this.#pageSize = Math.max(1, visible);
  }

  public lineUp(): void {
    this.#applyDelta(LINE_STEP);
  }

  public lineDown(): void {
    this.#applyDelta(-LINE_STEP);
  }

  public pageUp(): void {
    this.#applyDelta(this.#pageSize);
  }

  public pageDown(): void {
    this.#applyDelta(-this.#pageSize);
  }

  #applyDelta(delta: number): void {
    const next = clamp(this.#offset + delta, 0, this.#maxOffset);
    if (next === this.#offset) {
      return;
    }
    this.#offset = next;
    this.#emitter.emit('change');
  }
}
