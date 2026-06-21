import type { KeyAction } from '@shellicar/claude-core/input';
import type { Block, ConversationState } from '../model/ConversationState.js';
import type { HistoryViewState } from '../model/HistoryViewState.js';
import type { TerminalState } from '../model/TerminalState.js';
import { historyContentBudget, historyOpenLines } from '../view/historyContent.js';
import { historyKeyMap } from './historyKeyMap.js';
import type { InputHandler } from './InputHandler.js';

/**
 * Drives the outline: translates a key to a history Action via the state-aware
 * key-map, then applies it to HistoryViewState. Keys and actions stay logically
 * separate — the map decides what a key means in the current state, apply
 * performs it. Claims any key the map resolves; passes the rest down.
 *
 * When content is open it computes the bottom scroll bound — the rendered
 * content height (via the same helper the view renders with) minus the visible
 * budget — so the state clamps scrolling exactly to the box. Reads sealed blocks
 * and the terminal size; mutates only HistoryViewState.
 */
export class HistoryNavHandler implements InputHandler {
  readonly #state: HistoryViewState;
  readonly #conversation: ConversationState;
  readonly #terminal: TerminalState;

  public constructor(state: HistoryViewState, conversation: ConversationState, terminal: TerminalState) {
    this.#state = state;
    this.#conversation = conversation;
    this.#terminal = terminal;
  }

  public handleKey(key: KeyAction): boolean {
    const action = historyKeyMap(this.#state, key);
    if (action === null) {
      return false;
    }
    const blocks = this.#conversation.sealedBlocks;
    this.#state.apply(action, blocks, this.#maxScroll(blocks));
    return true;
  }

  /** The largest valid scroll offset for the open content, or infinity when nothing is open (list actions ignore it). */
  #maxScroll(blocks: ReadonlyArray<Block>): number {
    if (this.#state.mode !== 'content') {
      return Number.POSITIVE_INFINITY;
    }
    const block = blocks[this.#state.focus.block];
    if (!block) {
      return 0;
    }
    const lines = historyOpenLines(block, this.#state.focus, this.#terminal.cols);
    const budget = historyContentBudget(this.#state.focus, this.#terminal.rows);
    return Math.max(0, lines.length - budget);
  }
}
