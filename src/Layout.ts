import stringWidth from 'string-width';
import type { EditorRender } from './renderer.js';

/**
 * Output from an existing builder (status, attachment, preview).
 * `rows` are logical lines as the builder produces them (may be wider than columns).
 * `height` is the visual height in terminal rows (accounts for wrapping).
 */
export interface BuiltComponent {
  rows: string[];
  height: number;
}

export interface LayoutInput {
  editor: EditorRender;
  status: BuiltComponent | null;
  attachments: BuiltComponent | null;
  preview: BuiltComponent | null;
  question: BuiltComponent | null;
  columns: number;
}

/**
 * Layout output. `buffer` contains one entry per visual (terminal) row.
 * Layout is responsible for wrapping: a logical line wider than `columns`
 * becomes multiple buffer entries.
 */
export interface LayoutResult {
  buffer: string[];
  cursorRow: number;
  cursorCol: number;
  editorStartRow: number;
}

/**
 * Splits a logical line into visual rows by wrapping at `columns` visual width.
 * Returns at least one entry (empty string for empty input).
 */
function wrapLine(line: string, columns: number): string[] {
  if (stringWidth(line) <= columns) {
    return [line];
  }
  const segments: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const char of line) {
    const cw = stringWidth(char);
    if (currentWidth + cw > columns) {
      segments.push(current);
      current = char;
      currentWidth = cw;
    } else {
      current += char;
      currentWidth += cw;
    }
  }
  if (current.length > 0 || segments.length === 0) {
    segments.push(current);
  }
  return segments;
}

/**
 * Pure layout function. Takes all UI components and returns an unbounded
 * buffer of visual rows with cursor position metadata.
 *
 * Buffer order (top to bottom): question, status, attachments, preview, editor.
 */
export function layout(input: LayoutInput): LayoutResult {
  const { editor, status, attachments, preview, question, columns } = input;
  const buffer: string[] = [];

  for (const component of [question, status, attachments, preview]) {
    if (component !== null) {
      for (const row of component.rows) {
        buffer.push(...wrapLine(row, columns));
      }
    }
  }

  const editorStartRow = buffer.length;

  for (const line of editor.lines) {
    buffer.push(...wrapLine(line, columns));
  }

  return {
    buffer,
    cursorRow: editorStartRow + editor.cursorRow,
    cursorCol: editor.cursorCol,
    editorStartRow,
  };
}
