import type { KeyAction } from '@shellicar/claude-core/input';
import { dependsOn } from '@shellicar/core-di';
import { IConversationListLoader } from '../conversations/ConversationListLoader.js';
import { IAppModeState } from '../model/AppModeState.js';
import { IConversationListState } from '../model/ConversationListState.js';
import { IConversationState } from '../model/ConversationState.js';
import { IHistoryViewState } from '../model/HistoryViewState.js';
import type { InputHandler } from './InputHandler.js';

/**
 * Direct view selection, reachable from every presentation's chain: F1 selects
 * the primary view, F2 the history view, F3 the conversation view. setActive is
 * a no-op when the target is already active. Claims only those keys and passes
 * everything else down, so it is safe at the front of any chain; there is no
 * enter/exit asymmetry — each view has its own key.
 *
 * Entry to history focuses the latest block (the bottom): pressing F2 from
 * outside history resets the focus to the newest block, so no focus state is
 * kept across exits. Re-pressing F2 while already in history leaves the focus
 * untouched.
 */
export class ViewSelectHandler implements InputHandler {
  @dependsOn(IAppModeState) private readonly appModeState!: IAppModeState;
  @dependsOn(IHistoryViewState) private readonly historyViewState!: IHistoryViewState;
  @dependsOn(IConversationState) private readonly conversation!: IConversationState;
  @dependsOn(IConversationListState) private readonly conversationListState!: IConversationListState;
  @dependsOn(IConversationListLoader) private readonly conversationListLoader!: IConversationListLoader;

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
    // Entry rebuilds the list and starts the summary reads: a conversation may have been created or
    // written to since the last visit, including by another CLI sharing the store.
    if (key.type === 'f3') {
      if (this.appModeState.active !== 'conversations') {
        this.conversationListState.reset();
      }
      this.conversationListLoader.refresh();
      this.appModeState.setActive('conversations');
      return true;
    }
    return false;
  }
}
