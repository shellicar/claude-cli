/**
 * Pure text buffer with cursor management.
 * No I/O — just data manipulation.
 */

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
    const newLine = line.slice(0, cursor.col - 1) + line.slice(cursor.col);
    const newLines = [...lines];
    newLines[cursor.row] = newLine;
    return { lines: newLines, cursor: { row: cursor.row, col: cursor.col - 1 } };
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
    const newLine = line.slice(0, cursor.col) + line.slice(cursor.col + 1);
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
  if (!match) return state;
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
  if (!match) return state;
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
    return { lines, cursor: { row: cursor.row, col: cursor.col - 1 } };
  }
  if (cursor.row > 0) {
    return { lines, cursor: { row: cursor.row - 1, col: lines[cursor.row - 1].length } };
  }
  return state;
}

export function moveRight(state: EditorState): EditorState {
  const { lines, cursor } = state;
  if (cursor.col < lines[cursor.row].length) {
    return { lines, cursor: { row: cursor.row, col: cursor.col + 1 } };
  }
  if (cursor.row < lines.length - 1) {
    return { lines, cursor: { row: cursor.row + 1, col: 0 } };
  }
  return state;
}

export function moveUp(state: EditorState): EditorState {
  const { lines, cursor } = state;
  if (cursor.row > 0) {
    const newCol = Math.min(cursor.col, lines[cursor.row - 1].length);
    return { lines, cursor: { row: cursor.row - 1, col: newCol } };
  }
  return state;
}

export function moveDown(state: EditorState): EditorState {
  const { lines, cursor } = state;
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
  if (!match) return state;
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
  if (!match) return state;
  return { lines, cursor: { row: cursor.row, col: cursor.col + match[0].length } };
}
