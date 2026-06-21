import type { Block } from '../model/ConversationState.js';
import type { Focus } from '../model/HistoryViewState.js';
import { renderBlockContent } from './renderConversation.js';

/** Indent for an open box's content lines. */
export const HISTORY_CONTENT_INDENT = '   ';

/**
 * The full, un-windowed content lines the focus currently has open: a block's
 * content, or the focused tool's input/output. Empty when nothing is open here.
 *
 * Shared so the view renders the same lines the nav handler measures for scroll
 * clamping — one source for the rendered (wrapped) content height.
 */
export function historyOpenLines(block: Block, focus: Focus, cols: number): string[] {
  if (block.type !== 'tools') {
    return renderBlockContent(block.content, cols, HISTORY_CONTENT_INDENT);
  }
  const entry = focus.tool === null ? undefined : block.tools?.[focus.tool];
  if (!entry) {
    return [];
  }
  return [
    `${HISTORY_CONTENT_INDENT}input`,
    ...renderBlockContent(JSON.stringify(entry.input ?? {}), cols, `${HISTORY_CONTENT_INDENT}  `),
    `${HISTORY_CONTENT_INDENT}output`,
    ...renderBlockContent(entry.output ?? '', cols, `${HISTORY_CONTENT_INDENT}  `),
  ];
}

/** Lines available for an open box's content given the screen height (header/footer chrome reserved). A tool's i/o sits deeper in the tools box, so it reserves more. */
export function historyContentBudget(focus: Focus, rows: number): number {
  const bodyHeight = Math.max(1, rows - 1);
  return focus.tool === null ? Math.max(1, bodyHeight - 3) : Math.max(1, bodyHeight - 6);
}
