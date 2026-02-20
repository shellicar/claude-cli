/**
 * Pure content preparation for the editor area.
 * Computes what to display without writing to stdout.
 */

import type { EditorState } from './editor.js';

const CONTINUATION = '  ';

export interface EditorRender {
  lines: string[];
  cursorRow: number;
  cursorCol: number;
}

export function prepareEditor(editor: EditorState, prompt: string): EditorRender {
  const columns = process.stdout.columns || 80;
  const lines: string[] = [];

  for (let i = 0; i < editor.lines.length; i++) {
    const prefix = i === 0 ? prompt : CONTINUATION;
    lines.push(prefix + editor.lines[i]);
  }

  const cursorPrefix = editor.cursor.row === 0 ? prompt : CONTINUATION;
  const cursorCol = cursorPrefix.length + editor.cursor.col;

  let cursorRow = 0;
  for (let i = 0; i < editor.cursor.row; i++) {
    cursorRow += Math.max(1, Math.ceil(lines[i].length / columns));
  }

  return { lines, cursorRow, cursorCol };
}
