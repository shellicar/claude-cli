import type { ConversationState } from '../model/ConversationState.js';
import type { TerminalState } from '../model/TerminalState.js';
import { renderBlocksToString } from './renderConversation.js';
import type { TerminalRenderer } from './TerminalRenderer.js';

/**
 * Write any newly sealed blocks to the terminal scrollback so conversation
 * history survives leaving the alt buffer. Replaces AppLayout.#flushToScroll;
 * called at turn boundaries by runAgent.
 */
export function flushSealedToScroll(state: ConversationState, terminalState: TerminalState, renderer: TerminalRenderer): void {
  const sealedBlocks = state.sealedBlocks;
  const flushedCount = state.flushedCount;
  if (flushedCount >= sealedBlocks.length) {
    return;
  }
  const out = renderBlocksToString(sealedBlocks, flushedCount, terminalState.cols);
  state.advanceFlushedCount(sealedBlocks.length);
  renderer.writeToScroll(out);
}
