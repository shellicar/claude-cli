import type { KeyAction } from '@shellicar/claude-core/input';
import { dependsOn } from '@shellicar/core-di-lite';
import { AppModeState } from '../model/AppModeState.js';
import { ConversationState } from '../model/ConversationState.js';
import { HistoryViewState } from '../model/HistoryViewState.js';
import type { InputHandler } from './InputHandler.js';

/**
 * Direct view selection, reachable from every presentation's chain: F1 selects
 * the primary view, F2 the history view. setActive is a no-op when the target
 * is already active. Claims only F1/F2 and passes everything else down, so it is
 * safe at the front of any chain; there is no enter/exit asymmetry — each view
 * has its own key.
 *
 * Entry to history focuses the latest block (the bottom): pressing F2 from
 * outside history resets the focus to the newest block, so no focus state is
 * kept across exits. Re-pressing F2 while already in history leaves the focus
 * untouched.
 */
export class ViewSelectHandler implements InputHandler {
  @dependsOn(AppModeState) private readonly appModeState!: AppModeState;
  @dependsOn(HistoryViewState) private readonly historyViewState!: HistoryViewState;
  @dependsOn(ConversationState) private readonly conversation!: ConversationState;

  public handleKey(key: KeyAction): boolean {
    if (key.type === 'f1') {
      this.appModeState.setActive('primary');
      return true;
    }
    if (key.type === 'f2') {
      if (this.appModeState.active !== 'history') {
        this.historyViewState.enterAtLatest(this.conversation.sealedBlocks.length);
      }
      this.appModeState.setActive('history');
      return true;
    }
    return false;
  }
}
