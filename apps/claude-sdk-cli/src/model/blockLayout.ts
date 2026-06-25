import { wrapLine } from '@shellicar/claude-core/reflow';
import type { Block } from './ConversationState.js';
import type { Focus, HistoryContentExtent } from './HistoryViewState.js';

const CODE_FENCE_RE = /```(\w*)\n([\s\S]*?)```/g;

/**
 * Decorates a code-fence body for display. Must return one line per source line:
 * decoration (syntax colour) paints inside a line and never adds or removes one.
 * That count-preserving contract is what lets the scroll measurement use a plain
 * decorator and still agree with the height the view renders.
 */
export type CodeDecorator = (code: string, lang: string) => string[];

/** The measurement decorator: structure only, no colour. */
const plainCode: CodeDecorator = (code) => code.split('\n');

/**
 * Lay a block's content out into display rows: split on code fences, wrap text to
 * the column width, hand each code-fence body to `decorate`. This is the single
 * place that decides how many rows content occupies — the view passes a
 * highlighting decorator to render, the scroll measurement passes a plain one to
 * count, and the two agree because decoration is count-preserving. Lives in
 * model/ — the bottom layer both view/ and controller/ import — so neither layer
 * reaches across to the other for the rendered height.
 */
export function blockContentLines(content: string, cols: number, indent: string, decorate: CodeDecorator): string[] {
  const result: string[] = [];
  let lastIndex = 0;

  const addText = (text: string) => {
    const lines = text.split('\n');
    const trimmed = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
    for (const line of trimmed) {
      result.push(...wrapLine(indent + line, cols));
    }
  };

  for (const match of content.matchAll(CODE_FENCE_RE)) {
    if (match.index > lastIndex) {
      addText(content.slice(lastIndex, match.index));
    }
    const lang = match[1] || 'plaintext';
    const code = (match[2] ?? '').trimEnd();
    result.push(`${indent}\`\`\`${lang}`);
    for (const line of decorate(code, lang)) {
      result.push(indent + line);
    }
    result.push(`${indent}\`\`\``);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    addText(content.slice(lastIndex));
  } else if (lastIndex === 0) {
    addText(content);
  }

  return result;
}

/** Indent for an open box's content lines. */
export const HISTORY_CONTENT_INDENT = '   ';

/**
 * The full, un-windowed content lines the focus currently has open: a block's
 * content, or the focused tool's input/output. Empty when nothing is open here.
 * `decorate` selects display (highlighted, from the view) or measurement (plain);
 * the row count is identical either way, so one walker serves both.
 */
export function historyOpenLines(block: Block, focus: Focus, cols: number, decorate: CodeDecorator): string[] {
  if (block.type !== 'tools') {
    return blockContentLines(block.content, cols, HISTORY_CONTENT_INDENT, decorate);
  }
  const entry = focus.tool === null ? undefined : block.tools?.[focus.tool];
  if (!entry) {
    return [];
  }
  return [`${HISTORY_CONTENT_INDENT}input`, ...blockContentLines(JSON.stringify(entry.input ?? {}), cols, `${HISTORY_CONTENT_INDENT}  `, decorate), `${HISTORY_CONTENT_INDENT}output`, ...blockContentLines(entry.output ?? '', cols, `${HISTORY_CONTENT_INDENT}  `, decorate)];
}

/** Lines available for an open box's content given the screen height (header/footer chrome reserved). A tool's i/o sits deeper in the tools box, so it reserves more. */
export function historyContentBudget(focus: Focus, rows: number): number {
  const bodyHeight = Math.max(1, rows - 1);
  return focus.tool === null ? Math.max(1, bodyHeight - 3) : Math.max(1, bodyHeight - 6);
}

/**
 * The bottom scroll bound for the focused open content: its rendered (wrapped)
 * height minus the visible budget. Measured with the plain decorator — colour
 * never changes the line count — so the controller depends only on this bottom
 * layer to clamp scrolling, never on the view.
 */
export const historyContentExtent: HistoryContentExtent = (block, focus, cols, rows) => {
  const lines = historyOpenLines(block, focus, cols, plainCode);
  const budget = historyContentBudget(focus, rows);
  return Math.max(0, lines.length - budget);
};
