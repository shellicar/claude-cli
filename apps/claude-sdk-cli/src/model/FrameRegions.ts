import type { ClickRegion } from './ClickRegion.js';

/**
 * The clickable spans of the frame currently on screen. Written by the render
 * coordinator each paint and read by the input chain when a click arrives, which is the
 * seam between the two: the view is the only thing that knows where it drew anything,
 * and the input chain is the only thing that knows a click happened.
 *
 * Replaced wholesale rather than accumulated, because a frame is rebuilt whole.
 */
/** The state's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IFrameRegions {
  public abstract get current(): readonly ClickRegion[];
  public abstract set(regions: readonly ClickRegion[]): void;
}

export class FrameRegions extends IFrameRegions {
  #regions: readonly ClickRegion[] = [];

  public get current(): readonly ClickRegion[] {
    return this.#regions;
  }

  public set(regions: readonly ClickRegion[]): void {
    this.#regions = regions;
  }
}
