/**
 * Pure text buffer with cursor management.
 * No I/O. Just data manipulation.
 */

import stringWidth from 'string-width';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Returns the byte offset in `text` where cumulative visual width first reaches
 * or exceeds `targetWidth`. If `targetWidth` is beyond the end of the text, the
 * full string length is returned.
 */
function byteOffsetAtVisualWidth(text: string, targetWidth: number): number {
  if (targetWidth <= 0) {
    return 0;
  }
  const segs = [...segmenter.segment(text)];
  let w = 0;
  let lastEnd = 0;
  for (const seg of segs) {
    const sw = stringWidth(seg.segment);
    if (w + sw > targetWidth) {
      break;
    }
    w += sw;
    lastEnd = seg.index + seg.segment.length;
  }
  return lastEnd;
}

export interface CursorPosition {
  row: number;
  col: number;
}

export interface EditorState {
  lines: string[];
  cursor: CursorPosition;
}

export function createEditor(): EditorState {
  return {
    lines: [''],
    cursor: { row: 0, col: 0 },
  };
}

export function getText(state: EditorState): string {
  return state.lines.join('\n');
}

export function clear(_state: EditorState): EditorState {
  return createEditor();
}

export function insertChar(state: EditorState, char: string): EditorState {
  const { lines, cursor } = state;
  const line = lines[cursor.row];
  const newLine = line.slice(0, cursor.col) + char + line.slice(cursor.col);
  const newLines = [...lines];
  newLines[cursor.row] = newLine;
  return { lines: newLines, cursor: { row: cursor.row, col: cursor.col + char.length } };
}

export function insertNewline(state: EditorState): EditorState {
  const { lines, cursor } = state;
  const line = lines[cursor.row];
  const before = line.slice(0, cursor.col);
  const after = line.slice(cursor.col);
  const newLines = [...lines];
  newLines.splice(cursor.row, 1, before, after);
  return { lines: newLines, cursor: { row: cursor.row + 1, col: 0 } };
}

export function backspace(state: EditorState): EditorState {
  const { lines, cursor } = state;
  if (cursor.col > 0) {
    const line = lines[cursor.row];
    const before = line.slice(0, cursor.col);
    const segments = [...segmenter.segment(before)];
    const lastSeg = segments[segments.length - 1];
    const retreat = lastSeg?.segment.length ?? 1;
    const newLine = line.slice(0, cursor.col - retreat) + line.slice(cursor.col);
    const newLines = [...lines];
    newLines[cursor.row] = newLine;
    return { lines: newLines, cursor: { row: cursor.row, col: cursor.col - retreat } };
  }
  if (cursor.row > 0) {
    const prevLine = lines[cursor.row - 1];
    const curLine = lines[cursor.row];
    const newLines = [...lines];
    newLines.splice(cursor.row - 1, 2, prevLine + curLine);
    return { lines: newLines, cursor: { row: cursor.row - 1, col: prevLine.length } };
  }
  return state;
}

export function deleteChar(state: EditorState): EditorState {
  const { lines, cursor } = state;
  const line = lines[cursor.row];
  if (cursor.col < line.length) {
    const segments = [...segmenter.segment(line.slice(cursor.col))];
    const advance = segments[0]?.segment.length ?? 1;
    const newLine = line.slice(0, cursor.col) + line.slice(cursor.col + advance);
    const newLines = [...lines];
    newLines[cursor.row] = newLine;
    return { lines: newLines, cursor };
  }
  if (cursor.row < lines.length - 1) {
    const nextLine = lines[cursor.row + 1];
    const newLines = [...lines];
    newLines.splice(cursor.row, 2, line + nextLine);
    return { lines: newLines, cursor };
  }
  return state;
}

export function deleteWord(state: EditorState): EditorState {
  const { lines, cursor } = state;
  const line = lines[cursor.row];
  if (cursor.col >= line.length && cursor.row < lines.length - 1) {
    return deleteChar(state);
  }
  const after = line.slice(cursor.col);
  const match = after.match(/^(\s*\S+\s*|^\s+)/);
  if (!match) {
    return state;
  }
  const deleteLen = match[0].length;
  const newLine = line.slice(0, cursor.col) + line.slice(cursor.col + deleteLen);
  const newLines = [...lines];
  newLines[cursor.row] = newLine;
  return { lines: newLines, cursor };
}

export function deleteWordBackward(state: EditorState): EditorState {
  const { lines, cursor } = state;
  if (cursor.col === 0 && cursor.row > 0) {
    return backspace(state);
  }
  const before = lines[cursor.row].slice(0, cursor.col);
  const match = before.match(/(\S+\s*|\s+)$/);
  if (!match) {
    return state;
  }
  const deleteLen = match[0].length;
  const line = lines[cursor.row];
  const newLine = line.slice(0, cursor.col - deleteLen) + line.slice(cursor.col);
  const newLines = [...lines];
  newLines[cursor.row] = newLine;
  return { lines: newLines, cursor: { row: cursor.row, col: cursor.col - deleteLen } };
}

export function moveLeft(state: EditorState): EditorState {
  const { lines, cursor } = state;
  if (cursor.col > 0) {
    const before = lines[cursor.row].slice(0, cursor.col);
    const segments = [...segmenter.segment(before)];
    const lastSeg = segments[segments.length - 1];
    const retreat = lastSeg?.segment.length ?? 1;
    return { lines, cursor: { row: cursor.row, col: cursor.col - retreat } };
  }
  if (cursor.row > 0) {
    return { lines, cursor: { row: cursor.row - 1, col: lines[cursor.row - 1].length } };
  }
  return state;
}

export function moveRight(state: EditorState): EditorState {
  const { lines, cursor } = state;
  const line = lines[cursor.row];
  if (cursor.col < line.length) {
    const segments = [...segmenter.segment(line.slice(cursor.col))];
    const advance = segments[0]?.segment.length ?? 1;
    return { lines, cursor: { row: cursor.row, col: cursor.col + advance } };
  }
  if (cursor.row < lines.length - 1) {
    return { lines, cursor: { row: cursor.row + 1, col: 0 } };
  }
  return state;
}

export function moveUp(state: EditorState, columns?: number, prefixWidths?: number[]): EditorState {
  const { lines, cursor } = state;

  if (columns !== undefined && prefixWidths !== undefined) {
    const pw = prefixWidths[cursor.row];
    const line = lines[cursor.row];
    const visualOffset = pw + stringWidth(line.slice(0, cursor.col));
    const subRow = Math.floor(visualOffset / columns);
    const termCol = visualOffset % columns;

    if (subRow > 0) {
      const targetVisual = (subRow - 1) * columns + termCol;
      const textTarget = Math.max(0, targetVisual - pw);
      return { lines, cursor: { row: cursor.row, col: byteOffsetAtVisualWidth(line, textTarget) } };
    }

    if (cursor.row > 0) {
      const prevRow = cursor.row - 1;
      const prevPw = prefixWidths[prevRow];
      const prevLine = lines[prevRow];
      const prevTotalWidth = prevPw + stringWidth(prevLine);
      const prevLineSubRows = Math.max(1, Math.ceil(prevTotalWidth / columns));
      const lastSubRow = prevLineSubRows - 1;
      const targetVisual = Math.min(lastSubRow * columns + termCol, prevTotalWidth);
      const textTarget = Math.max(0, targetVisual - prevPw);
      return { lines, cursor: { row: prevRow, col: byteOffsetAtVisualWidth(prevLine, textTarget) } };
    }

    return state;
  }

  if (cursor.row > 0) {
    const newCol = Math.min(cursor.col, lines[cursor.row - 1].length);
    return { lines, cursor: { row: cursor.row - 1, col: newCol } };
  }
  return state;
}

export function moveDown(state: EditorState, columns?: number, prefixWidths?: number[]): EditorState {
  const { lines, cursor } = state;

  if (columns !== undefined && prefixWidths !== undefined) {
    const pw = prefixWidths[cursor.row];
    const line = lines[cursor.row];
    const visualOffset = pw + stringWidth(line.slice(0, cursor.col));
    const subRow = Math.floor(visualOffset / columns);
    const termCol = visualOffset % columns;
    const totalWidth = pw + stringWidth(line);
    const lineSubRows = Math.max(1, Math.ceil(totalWidth / columns));

    if (subRow + 1 < lineSubRows) {
      const targetVisual = Math.min((subRow + 1) * columns + termCol, totalWidth);
      const textTarget = Math.max(0, targetVisual - pw);
      return { lines, cursor: { row: cursor.row, col: byteOffsetAtVisualWidth(line, textTarget) } };
    }

    if (cursor.row < lines.length - 1) {
      const nextRow = cursor.row + 1;
      const nextPw = prefixWidths[nextRow];
      const nextLine = lines[nextRow];
      const textTarget = Math.max(0, termCol - nextPw);
      return { lines, cursor: { row: nextRow, col: byteOffsetAtVisualWidth(nextLine, textTarget) } };
    }

    return state;
  }

  if (cursor.row < lines.length - 1) {
    const newCol = Math.min(cursor.col, lines[cursor.row + 1].length);
    return { lines, cursor: { row: cursor.row + 1, col: newCol } };
  }
  return state;
}

export function moveHome(state: EditorState): EditorState {
  const { lines, cursor } = state;
  return { lines, cursor: { row: cursor.row, col: 0 } };
}

export function moveEnd(state: EditorState): EditorState {
  const { lines, cursor } = state;
  return { lines, cursor: { row: cursor.row, col: lines[cursor.row].length } };
}

export function moveBufferStart(state: EditorState): EditorState {
  const { lines } = state;
  return { lines, cursor: { row: 0, col: 0 } };
}

export function moveBufferEnd(state: EditorState): EditorState {
  const { lines } = state;
  const lastRow = lines.length - 1;
  return { lines, cursor: { row: lastRow, col: lines[lastRow].length } };
}

export function moveWordLeft(state: EditorState): EditorState {
  const { lines, cursor } = state;
  if (cursor.col === 0 && cursor.row > 0) {
    return { lines, cursor: { row: cursor.row - 1, col: lines[cursor.row - 1].length } };
  }
  const before = lines[cursor.row].slice(0, cursor.col);
  const match = before.match(/(\S+\s*|\s+)$/);
  if (!match) {
    return state;
  }
  return { lines, cursor: { row: cursor.row, col: cursor.col - match[0].length } };
}

export function moveWordRight(state: EditorState): EditorState {
  const { lines, cursor } = state;
  const line = lines[cursor.row];
  if (cursor.col >= line.length && cursor.row < lines.length - 1) {
    return { lines, cursor: { row: cursor.row + 1, col: 0 } };
  }
  const after = line.slice(cursor.col);
  const match = after.match(/^(\s*\S+\s*|\s+)/);
  if (!match) {
    return state;
  }
  return { lines, cursor: { row: cursor.row, col: cursor.col + match[0].length } };
}
