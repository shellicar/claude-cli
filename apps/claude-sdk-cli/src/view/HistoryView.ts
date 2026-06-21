import type { Block } from '../model/ConversationState.js';
import type { HistoryViewState } from '../model/HistoryViewState.js';
import { HISTORY_CONTENT_INDENT, historyContentBudget, historyOpenLines } from './historyContent.js';
import { buildDivider, renderBlockContent } from './renderConversation.js';
import { renderViewBar } from './renderViewBar.js';
import type { View, ViewModel } from './View.js';

const LABEL: Record<string, string> = {
  prompt: 'prompt',
  thinking: 'thinking',
  response: 'response',
  tools: 'tools',
  compaction: 'compaction',
  meta: 'query',
  notice: 'notice',
};

/** Max content lines a collapsed box shows before it caps with a `...` line. */
const COLLAPSED_CONTENT_LINES = 6;
/** The gutter that marks the focused box / tool while it is collapsed. */
const GUTTER = '> ';
const ELLIPSIS = `${HISTORY_CONTENT_INDENT}...`;

/**
 * The history render surface: the session's sealed blocks as a vertical stack
 * of boxes. While navigating, every box is collapsed — its header plus content
 * capped at a few lines, with a `...` line only when there is more — and the
 * focused box is centred on the screen, the boxes before and after it bleeding
 * off the top and bottom edges.
 *
 * `[open]` grows the focused box to its full content, bounded by the content and
 * capped at the screen: content that fits is shown whole; content taller than
 * the screen is slid by scrollOffset, its header fixed and a `...` line marking
 * more above or below. Nothing is drawn for the scroll boundary itself — it is
 * the box edge. Tools blocks nest the same box model. Render-only.
 */
export class HistoryView implements View {
  public render(model: ViewModel): string[] {
    const { conversationState, historyViewState, terminalState, appModeState } = model;
    const cols = terminalState.cols;
    const rows = terminalState.rows;
    const blocks = conversationState.sealedBlocks;
    // Reserve the last row for the footer view bar; the boxes fill the rest.
    const bodyHeight = Math.max(1, rows - 1);

    const stack: string[] = [];
    let focusedStart = 0;
    let focusedLen = 0;
    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b];
      if (!block) {
        continue;
      }
      const focused = historyViewState.focus.block === b;
      const card = this.#blockCard(block, focused, historyViewState, cols, rows);
      if (focused) {
        focusedStart = stack.length;
        focusedLen = card.length;
      }
      stack.push(...card);
    }

    const body = this.#centre(stack, focusedStart, focusedLen, bodyHeight);
    body.push(renderViewBar(appModeState.active));
    return body;
  }

  /**
   * Slice the stack so the focused card's midline sits on the screen midline.
   * Neighbours bleed off the edges; a clipped edge shows `...`. When the stack
   * is shorter than the screen it is shown whole (no clip, no `...`).
   */
  #centre(stack: string[], start: number, len: number, height: number): string[] {
    const out: string[] = [];
    if (stack.length === 0) {
      return new Array<string>(height).fill('');
    }
    const focusMid = start + Math.floor(len / 2);
    const top = focusMid - Math.floor(height / 2);
    for (let i = 0; i < height; i++) {
      const idx = top + i;
      out.push(idx >= 0 && idx < stack.length ? (stack[idx] ?? '') : '');
    }
    if (top > 0) {
      out[0] = '...';
    }
    if (top + height < stack.length) {
      out[height - 1] = '...';
    }
    return out;
  }

  #blockCard(block: Block, focused: boolean, hv: HistoryViewState, cols: number, rows: number): string[] {
    if (block.type === 'tools') {
      return this.#toolsCard(block, focused, hv, cols, rows);
    }
    const label = LABEL[block.type] ?? block.type;

    // Open: grow to the full content, slid by scrollOffset when taller than the screen.
    if (focused && hv.contentOpen) {
      const lines = historyOpenLines(block, hv.focus, cols);
      const body = this.#window(lines, historyContentBudget(hv.focus, rows), hv.scrollOffset);
      return [buildDivider(`${label}  (open)`, cols), ...body, buildDivider(null, cols)];
    }

    // Focused but collapsed: gutter every line, cap the content.
    if (focused) {
      const inner = cols - GUTTER.length;
      const capped = this.#cap(renderBlockContent(block.content, inner, HISTORY_CONTENT_INDENT));
      return [`${GUTTER}${buildDivider(`${label}  (focused)`, inner)}`, ...capped.map((l) => `${GUTTER}${l}`)];
    }

    // Unfocused: flush, collapsed.
    return [buildDivider(label, cols), ...this.#cap(renderBlockContent(block.content, cols, HISTORY_CONTENT_INDENT))];
  }

  #toolsCard(block: Block, focused: boolean, hv: HistoryViewState, cols: number, rows: number): string[] {
    const tools = block.tools ?? [];
    const n = tools.length;
    const descended = focused && hv.focus.tool !== null;

    // Open: list the tools; the focused tool is gutter-marked, and an opened tool
    // grows to its input/output, slid by scrollOffset when taller than the screen.
    if (descended) {
      const out: string[] = [buildDivider(`tools (${n})  (open)`, cols)];
      for (let t = 0; t < tools.length; t++) {
        const entry = tools[t];
        if (!entry) {
          continue;
        }
        const onTool = hv.focus.tool === t;
        out.push(`${onTool ? GUTTER : '  '}${entry.name}`);
        if (onTool && hv.contentOpen) {
          const io = historyOpenLines(block, hv.focus, cols);
          out.push(...this.#window(io, historyContentBudget(hv.focus, rows), hv.scrollOffset));
        }
      }
      out.push(buildDivider(null, cols));
      return out;
    }

    // Collapsed: a one-line preview of the tool names.
    const names = tools.map((tool) => tool.name).join(' . ');
    if (focused) {
      const inner = cols - GUTTER.length;
      const preview = this.#cap(renderBlockContent(names, inner, HISTORY_CONTENT_INDENT));
      return [`${GUTTER}${buildDivider(`tools (${n})  (focused)`, inner)}`, ...preview.map((l) => `${GUTTER}${l}`)];
    }
    return [buildDivider(`tools (${n})`, cols), ...this.#cap(renderBlockContent(names, cols, HISTORY_CONTENT_INDENT))];
  }

  /** Cap a collapsed box's content: keep the first lines, mark more with a `...` line — only when there is more. */
  #cap(lines: string[]): string[] {
    return lines.length > COLLAPSED_CONTENT_LINES ? [...lines.slice(0, COLLAPSED_CONTENT_LINES - 1), ELLIPSIS] : lines;
  }

  /**
   * Open content shown whole when it fits the budget, else a window slid by the
   * scroll offset. A `...` line replaces the first/last visible line only when
   * content is hidden in that direction. No boundary is drawn — it is the box edge.
   */
  #window(lines: string[], budget: number, scrollOffset: number): string[] {
    if (lines.length <= budget) {
      return lines;
    }
    const maxOffset = lines.length - budget;
    const offset = Math.min(Math.max(0, scrollOffset), maxOffset);
    const view = lines.slice(offset, offset + budget);
    if (offset > 0) {
      view[0] = ELLIPSIS;
    }
    if (offset + budget < lines.length) {
      view[view.length - 1] = ELLIPSIS;
    }
    return view;
  }
}
