import type { KeyAction } from '@shellicar/claude-core/input';
import { dependsOn } from '@shellicar/core-di-lite';
import { ScrollState } from '../model/ScrollState.js';
import type { InputHandler } from './InputHandler.js';

/**
 * Scrolls the primary transcript. Claims the wheel (scroll_up/scroll_down, one
 * notch at a time) and PageUp/PageDown (a viewport at a time), and passes
 * everything else down — so it is safe anywhere in a chain, including ahead of
 * the editor, where scroll keys must not reach the composer. Owns only
 * ScrollState; nothing auto-snaps, so it never touches another concern.
 */
export class ScrollHandler implements InputHandler {
  @dependsOn(ScrollState) private readonly scrollState!: ScrollState;

  public handleKey(key: KeyAction): boolean {
    switch (key.type) {
      case 'scroll_up':
        this.scrollState.lineUp();
        return true;
      case 'scroll_down':
        this.scrollState.lineDown();
        return true;
      case 'page_up':
        this.scrollState.pageUp();
        return true;
      case 'page_down':
        this.scrollState.pageDown();
        return true;
      default:
        return false;
    }
  }
}
