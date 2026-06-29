import type { KeyAction } from '@shellicar/claude-core/input';
import { dependsOn } from '@shellicar/core-di-lite';
import { historyContentExtent } from '../model/blockLayout.js';
import { type Block, ConversationState } from '../model/ConversationState.js';
import { HistoryViewState } from '../model/HistoryViewState.js';
import { TerminalState } from '../model/TerminalState.js';
import { historyKeyMap } from './historyKeyMap.js';
import type { InputHandler } from './InputHandler.js';

/**
 * Drives the outline: translates a key to a history Action via the state-aware
 * key-map, then applies it to HistoryViewState. Keys and actions stay logically
 * separate — the map decides what a key means in the current state, apply
 * performs it. Claims any key the map resolves; passes the rest down.
 *
 * When content is open it computes the bottom scroll bound — the rendered
 * content height minus the visible budget — so the state clamps scrolling
 * exactly to the box. The height comes from historyContentExtent in the model
 * layer (layout without the view's colour), so the handler never reaches into
 * the view. Reads sealed blocks and the terminal size; mutates only HistoryViewState.
 */
export class HistoryNavHandler implements InputHandler {
  @dependsOn(HistoryViewState) private readonly state!: HistoryViewState;
  @dependsOn(ConversationState) private readonly conversation!: ConversationState;
  @dependsOn(TerminalState) private readonly terminal!: TerminalState;

  public handleKey(key: KeyAction): boolean {
    const action = historyKeyMap(this.state, key);
    if (action === null) {
      return false;
    }
    const blocks = this.conversation.sealedBlocks;
    this.state.apply(action, blocks, this.#maxScroll(blocks));
    return true;
  }

  /** The largest valid scroll offset for the open content, or infinity when nothing is open (list actions ignore it). */
  #maxScroll(blocks: ReadonlyArray<Block>): number {
    if (this.state.mode !== 'content') {
      return Number.POSITIVE_INFINITY;
    }
    const block = blocks[this.state.focus.block];
    if (!block) {
      return 0;
    }
    return historyContentExtent(block, this.state.focus, this.terminal.cols, this.terminal.rows);
  }
}
