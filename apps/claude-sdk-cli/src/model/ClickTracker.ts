import type { ClickRegion } from './ClickRegion.js';

/**
 * Pairs a mouse press with its release so a click fires only when both land on the
 * same target. A press remembers the region it landed on; a release resolves its own
 * coordinate and returns the pressed region when the two are the same target.
 *
 * Holding the press against the target rather than the coordinate is what makes this
 * self-correcting. Both ends resolve against whatever frame is on screen at the time, so
 * a scroll or a streaming repaint between them needs no special handling: either the
 * release lands on the same target, or it does not. A release tmux swallowed during a
 * drag simply never fires.
 *
 * Targets are compared by id, not by what they copy. Two blocks can hold identical text,
 * the same prompt sent twice, and a drag from one to the other has to cancel, which it
 * cannot do while the payload is the identity.
 */
/** The state's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IClickTracker {
  public abstract press(region: ClickRegion | null): void;
  public abstract release(region: ClickRegion | null): ClickRegion | null;
}

export class ClickTracker extends IClickTracker {
  #pressed: ClickRegion | null = null;

  public press(region: ClickRegion | null): void {
    this.#pressed = region;
  }

  public release(region: ClickRegion | null): ClickRegion | null {
    const pressed = this.#pressed;
    this.#pressed = null;
    if (pressed === null || region === null || pressed.id !== region.id) {
      return null;
    }
    return pressed;
  }
}
