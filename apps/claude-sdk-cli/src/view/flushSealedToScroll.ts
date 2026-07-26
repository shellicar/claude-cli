import type { MarkdownConfig } from '../cli-config/types.js';
import type { IConversationState } from '../model/ConversationState.js';
import type { ITerminalState } from '../model/TerminalState.js';
import { renderBlocksToString } from './renderConversation.js';
import type { TerminalRenderer } from './TerminalRenderer.js';

/**
 * Write any newly sealed blocks to the terminal scrollback so conversation
 * history survives leaving the alt buffer. Replaces AppLayout.#flushToScroll;
 * called at turn boundaries by runAgent.
 */
export function flushSealedToScroll(state: IConversationState, terminalState: ITerminalState, renderer: TerminalRenderer, markdown?: MarkdownConfig): void {
  const sealedBlocks = state.sealedBlocks;
  const flushedCount = state.flushedCount;
  if (flushedCount >= sealedBlocks.length) {
    return;
  }
  const out = renderBlocksToString(sealedBlocks, flushedCount, terminalState.cols, markdown);
  state.advanceFlushedCount(sealedBlocks.length);
  renderer.writeToScroll(out);
}
