import { Clock } from '@js-joda/core';
import type { KeyAction } from '@shellicar/claude-core/input';
import { dependsOn } from '@shellicar/core-di';
import { hitTest } from '../model/ClickRegion.js';
import { IClickTracker } from '../model/ClickTracker.js';
import { IClipboard } from '../model/Clipboard.js';
import { IFrameRegions } from '../model/FrameRegions.js';
import { StatusState } from '../model/StatusState.js';
import type { InputHandler } from './InputHandler.js';

/**
 * Turns a click on the frame into a copy. A press remembers the target under the
 * pointer; a release on the same target copies its text. Anything else that arrives
 * abandons the press, because a gesture interrupted by a keystroke, a scroll or a second
 * button is not a click.
 *
 * Claims both mouse events whether or not they hit anything, so a click on empty space
 * never travels on to the editor as input.
 */
export class ClickHandler implements InputHandler {
  @dependsOn(IFrameRegions) private readonly frameRegions!: IFrameRegions;
  @dependsOn(IClickTracker) private readonly tracker!: IClickTracker;
  @dependsOn(IClipboard) private readonly clipboard!: IClipboard;
  @dependsOn(StatusState) private readonly statusState!: StatusState;
  @dependsOn(Clock) private readonly clock!: Clock;

  public handleKey(key: KeyAction): boolean {
    if (key.type === 'mouse_down') {
      this.tracker.press(hitTest(this.frameRegions.current, key.col, key.row));
      return true;
    }
    if (key.type === 'mouse_up') {
      const target = this.tracker.release(hitTest(this.frameRegions.current, key.col, key.row));
      if (target !== null) {
        this.clipboard.write(target.text);
        this.statusState.markCopied(this.clock.instant(), target.text.split('\n').length);
      }
      return true;
    }
    this.tracker.clear();
    return false;
  }
}
