import type { KeyAction } from '@shellicar/claude-core/input';
import type { ConversationAction } from '../model/ConversationListState.js';

/**
 * Translation from a key to a conversation-list Action, kept separate from applying it.
 *
 * Unlike the history map this is state-free, and deliberately so: peek is a flat toggle rather than a
 * level you enter, so no key ever changes meaning. Up/down always move the selection, and the wheel is
 * the same action as the arrows because the list is what scrolls.
 *
 * `enter` is not here — switching conversation is not a navigation action, so its handler claims that
 * key directly.
 */
export function conversationKeyMap(key: KeyAction): ConversationAction | null {
  switch (key.type) {
    case 'up':
    case 'scroll_up':
      return 'prev';
    case 'down':
    case 'scroll_down':
      return 'next';
    case 'page_up':
      return 'page-up';
    case 'page_down':
      return 'page-down';
    case 'home':
      return 'home';
    case 'end':
      return 'end';
    case 'char':
      return key.value === ' ' ? 'toggle-peek' : null;
    default:
      return null;
  }
}
