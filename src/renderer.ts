/**
 * Minimal terminal renderer for the input area.
 * Only redraws what's needed — no full screen re-renders.
 */

import type { EditorState } from './editor.js';

const ESC = '\x1B[';

// Cursor movement
const cursorUp = (n: number) => (n > 0 ? `${ESC}${n}A` : '');
const cursorTo = (col: number) => `${ESC}${col + 1}G`;
const clearLine = `${ESC}2K`;
const clearDown = `${ESC}J`;

const PROMPT = '> ';
const CONTINUATION = '  ';

export interface RenderState {
  previousLineCount: number;
  cursorLinesFromBottom: number;
}

export function createRenderState(): RenderState {
  return { previousLineCount: 0, cursorLinesFromBottom: 0 };
}

export function render(editor: EditorState, renderState: RenderState, write: (data: string) => void): RenderState {
  const columns = process.stdout.columns || 80;
  let output = '';

  // Move cursor back to start of previous render
  // The cursor may be on any line (not necessarily the last), so we calculate
  // from where we actually left it
  if (renderState.previousLineCount > 0) {
    const linesToTop = renderState.previousLineCount - 1 - renderState.cursorLinesFromBottom;
    output += cursorUp(linesToTop);
    output += '\r';
  }

  // Clear from current position down
  output += clearDown;

  // Draw each line with prompt/continuation prefix
  let totalScreenLines = 0;
  for (let i = 0; i < editor.lines.length; i++) {
    const prefix = i === 0 ? PROMPT : CONTINUATION;
    const content = prefix + editor.lines[i];

    if (i > 0) {
      output += '\n';
    }
    output += clearLine + content;

    // Count screen lines (accounting for wrapping)
    totalScreenLines += Math.max(1, Math.ceil(content.length / columns));
  }

  // Position cursor at the correct location
  const cursorPrefix = editor.cursor.row === 0 ? PROMPT : CONTINUATION;
  const cursorScreenCol = cursorPrefix.length + editor.cursor.col;

  // Calculate how many screen lines from current position to cursor row
  let screenLinesFromEnd = 0;
  for (let i = editor.lines.length - 1; i > editor.cursor.row; i--) {
    const prefix = i === 0 ? PROMPT : CONTINUATION;
    const content = prefix + editor.lines[i];
    screenLinesFromEnd += Math.max(1, Math.ceil(content.length / columns));
  }

  if (screenLinesFromEnd > 0) {
    output += cursorUp(screenLinesFromEnd);
  }
  output += cursorTo(cursorScreenCol);

  write(output);

  return { previousLineCount: totalScreenLines, cursorLinesFromBottom: screenLinesFromEnd };
}
