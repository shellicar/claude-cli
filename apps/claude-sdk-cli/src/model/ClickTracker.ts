import type { ClickRegion } from './ClickRegion.js';

/**
 * Pairs a mouse press with its release so a click fires only when both land on the
 * same target. A press remembers the region it landed on; a release resolves its own
 * coordinate and returns the pressed region when the two are the same target.
 *
 * Holding the press against the target rather than the coordinate is what makes a
 * scroll or a streaming repaint between the two refuse the click: the content moved
 * out from under a stationary pointer, so the release is no longer on what was
 * pressed. It also means a release tmux swallowed during a drag simply never fires.
 */
/** The state's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IClickTracker {
  public abstract press(region: ClickRegion | null): void;
  public abstract release(region: ClickRegion | null): ClickRegion | null;
  public abstract clear(): void;
}

export class ClickTracker extends IClickTracker {
  #pressed: ClickRegion | null = null;

  public press(region: ClickRegion | null): void {
    this.#pressed = region;
  }

  public release(region: ClickRegion | null): ClickRegion | null {
    const pressed = this.#pressed;
    this.#pressed = null;
    if (pressed === null || region === null || pressed.text !== region.text) {
      return null;
    }
    return pressed;
  }

  public clear(): void {
    this.#pressed = null;
  }
}
