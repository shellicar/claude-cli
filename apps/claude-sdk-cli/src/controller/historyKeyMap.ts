import type { KeyAction } from '@shellicar/claude-core/input';
import type { HistoryAction, HistoryViewState } from '../model/HistoryViewState.js';

/**
 * State-aware translation from a key to a history Action, kept separate from
 * applying it (historyKeyMap(viewState, key) -> Action, then state.apply).
 *
 * left/right are constant (out/in). up/down keep their direction and change only
 * granularity by the current mode — items on a list, lines inside open content.
 * page/home/end map to a single action each; the action itself is mode-aware
 * (jump blocks on a list, slide content when open), so muscle memory holds with
 * no remembered mode.
 */
export function historyKeyMap(state: HistoryViewState, key: KeyAction): HistoryAction | null {
  const inContent = state.mode === 'content';
  switch (key.type) {
    case 'up':
      return inContent ? 'scroll-up' : 'prev';
    case 'down':
      return inContent ? 'scroll-down' : 'next';
    case 'page_up':
      return 'page-up';
    case 'page_down':
      return 'page-down';
    case 'home':
      return 'home';
    case 'end':
      return 'end';
    case 'right':
      return inContent ? null : 'open';
    case 'left':
      return 'close';
    default:
      return null;
  }
}
