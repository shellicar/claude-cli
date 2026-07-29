import type { KeyAction } from '@shellicar/claude-core/input';
import { dependsOn } from '@shellicar/core-di';
import { IConversationPeekLoader } from '../conversations/ConversationPeekLoader.js';
import { IConversationListState } from '../model/ConversationListState.js';
import { IPrimaryViewState } from '../model/PrimaryViewState.js';
import { IConversationSwitcher } from '../setup/ConversationSwitcher.js';
import { conversationKeyMap } from './conversationKeyMap.js';
import type { InputHandler } from './InputHandler.js';

/**
 * Drives the conversation list: navigation through the key-map, peek content loaded on demand, and
 * enter to switch.
 *
 * Peek content is read only when the peek opens, never when the list is drawn — the operator has
 * chosen to wait at that point, and most conversations are never peeked.
 *
 * Enter is refused mid-turn: a streaming turn belongs to the conversation being left, and moving out
 * from under it would strand its output. The refusal is silent rather than an error, because the view
 * shows which conversation is live and there is nothing to explain.
 */
export class ConversationNavHandler implements InputHandler {
  @dependsOn(IConversationListState) private readonly state!: IConversationListState;
  @dependsOn(IConversationPeekLoader) private readonly peekLoader!: IConversationPeekLoader;
  @dependsOn(IConversationSwitcher) private readonly switcher!: IConversationSwitcher;
  @dependsOn(IPrimaryViewState) private readonly primaryViewState!: IPrimaryViewState;

  public handleKey(key: KeyAction): boolean {
    if (key.type === 'enter') {
      this.#switch();
      return true;
    }
    const action = conversationKeyMap(key);
    if (action === null) {
      return false;
    }
    this.state.apply(action);
    // An open peek with no content is the one state that needs a read: it arises both from opening a
    // peek and from moving to another conversation with one already open.
    if (this.state.peeked && this.state.peek === undefined) {
      const id = this.state.selectedEntry?.id;
      if (id !== undefined) {
        this.peekLoader.load(id);
      }
    }
    return true;
  }

  #switch(): void {
    if (this.primaryViewState.phase !== 'editor') {
      return;
    }
    const id = this.state.selectedEntry?.id;
    if (id === undefined) {
      return;
    }
    void this.switcher.switchTo(id);
  }
}
