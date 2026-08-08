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
  public press(region: ClickRegion | null): void {
    throw new Error('press is not implemented');
  }

  public release(region: ClickRegion | null): ClickRegion | null {
    throw new Error('release is not implemented');
  }

  public clear(): void {
    throw new Error('clear is not implemented');
  }
}
