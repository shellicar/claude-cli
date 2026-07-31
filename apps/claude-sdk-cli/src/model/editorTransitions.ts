import type { KeyAction } from '@shellicar/claude-core/input';
import stringWidth from 'string-width';
import type { EditorContent } from './EditorContent.js';
import { colFromVisual, graphemeBoundaryAfter, graphemeBoundaryAtOrAfter, graphemeBoundaryBefore } from './graphemeBoundaries.js';
import type { IGraphemeSegmenter } from './IGraphemeSegmenter.js';

/** Returns the column index of the start of the word to the left of col. */
function wordStartLeft(line: string, col: number): number {
  let c = col;
  while (c > 0 && line[c - 1] === ' ') {
    c--;
  }
  while (c > 0 && line[c - 1] !== ' ') {
    c--;
  }
  return c;
}

/** Returns the column index of the end of the word to the right of col. */
function wordEndRight(line: string, col: number): number {
  let c = col;
  while (c < line.length && line[c] === ' ') {
    c++;
  }
  while (c < line.length && line[c] !== ' ') {
    c++;
  }
  return c;
}

/**
 * Apply an editor key to `content`, in place. Returns true if the key was
 * consumed. Returns false for `ctrl+enter` and any key not recognised here —
 * the caller handles those itself.
 *
 * `ctrl+enter` (submit) is intentionally absent: it involves attachments and a
 * promise resolve that live in AppLayout.
 */
export function handleKey(segmenter: IGraphemeSegmenter, content: EditorContent, key: KeyAction): boolean {
  switch (key.type) {
    case 'enter': {
      const cur = content.lines[content.cursorLine] ?? '';
      const before = cur.slice(0, content.cursorCol);
      const after = cur.slice(content.cursorCol);
      content.lines[content.cursorLine] = before;
      content.lines.splice(content.cursorLine + 1, 0, after);
      content.cursorLine++;
      content.cursorCol = 0;
      return true;
    }
    case 'backspace': {
      if (content.cursorCol > 0) {
        const line = content.lines[content.cursorLine] ?? '';
        const start = graphemeBoundaryBefore(segmenter, line, content.cursorCol);
        content.lines[content.cursorLine] = line.slice(0, start) + line.slice(content.cursorCol);
        content.cursorCol = start;
      } else if (content.cursorLine > 0) {
        const prev = content.lines[content.cursorLine - 1] ?? '';
        const curr = content.lines[content.cursorLine] ?? '';
        content.lines.splice(content.cursorLine, 1);
        content.cursorLine--;
        content.cursorCol = prev.length;
        content.lines[content.cursorLine] = prev + curr;
      }
      return true;
    }
    case 'delete': {
      const line = content.lines[content.cursorLine] ?? '';
      if (content.cursorCol < line.length) {
        const end = graphemeBoundaryAfter(segmenter, line, content.cursorCol);
        content.lines[content.cursorLine] = line.slice(0, content.cursorCol) + line.slice(end);
      } else if (content.cursorLine < content.lines.length - 1) {
        const next = content.lines[content.cursorLine + 1] ?? '';
        content.lines.splice(content.cursorLine + 1, 1);
        content.lines[content.cursorLine] = line + next;
      }
      return true;
    }
    case 'ctrl+backspace': {
      if (content.cursorCol === 0) {
        if (content.cursorLine > 0) {
          const prev = content.lines[content.cursorLine - 1] ?? '';
          const curr = content.lines[content.cursorLine] ?? '';
          content.lines.splice(content.cursorLine, 1);
          content.cursorLine--;
          content.cursorCol = prev.length;
          content.lines[content.cursorLine] = prev + curr;
        }
      } else {
        const line = content.lines[content.cursorLine] ?? '';
        const newCol = wordStartLeft(line, content.cursorCol);
        content.lines[content.cursorLine] = line.slice(0, newCol) + line.slice(content.cursorCol);
        content.cursorCol = newCol;
      }
      return true;
    }
    case 'ctrl+delete': {
      const line = content.lines[content.cursorLine] ?? '';
      if (content.cursorCol === line.length) {
        if (content.cursorLine < content.lines.length - 1) {
          const next = content.lines[content.cursorLine + 1] ?? '';
          content.lines.splice(content.cursorLine + 1, 1);
          content.lines[content.cursorLine] = line + next;
        }
      } else {
        const newCol = wordEndRight(line, content.cursorCol);
        content.lines[content.cursorLine] = line.slice(0, content.cursorCol) + line.slice(newCol);
      }
      return true;
    }
    case 'ctrl+k': {
      const line = content.lines[content.cursorLine] ?? '';
      if (content.cursorCol < line.length) {
        content.lines[content.cursorLine] = line.slice(0, content.cursorCol);
      } else if (content.cursorLine < content.lines.length - 1) {
        const next = content.lines[content.cursorLine + 1] ?? '';
        content.lines.splice(content.cursorLine + 1, 1);
        content.lines[content.cursorLine] = line + next;
      }
      return true;
    }
    case 'ctrl+u': {
      const line = content.lines[content.cursorLine] ?? '';
      content.lines[content.cursorLine] = line.slice(content.cursorCol);
      content.cursorCol = 0;
      return true;
    }
    case 'left': {
      if (content.cursorCol > 0) {
        const line = content.lines[content.cursorLine] ?? '';
        content.cursorCol = graphemeBoundaryBefore(segmenter, line, content.cursorCol);
      } else if (content.cursorLine > 0) {
        content.cursorLine--;
        content.cursorCol = (content.lines[content.cursorLine] ?? '').length;
      }
      return true;
    }
    case 'right': {
      const line = content.lines[content.cursorLine] ?? '';
      if (content.cursorCol < line.length) {
        content.cursorCol = graphemeBoundaryAfter(segmenter, line, content.cursorCol);
      } else if (content.cursorLine < content.lines.length - 1) {
        content.cursorLine++;
        content.cursorCol = 0;
      }
      return true;
    }
    case 'home': {
      content.cursorCol = 0;
      return true;
    }
    case 'end': {
      content.cursorCol = (content.lines[content.cursorLine] ?? '').length;
      return true;
    }
    case 'ctrl+home': {
      content.cursorLine = 0;
      content.cursorCol = 0;
      return true;
    }
    case 'ctrl+end': {
      content.cursorLine = content.lines.length - 1;
      content.cursorCol = (content.lines[content.cursorLine] ?? '').length;
      return true;
    }
    case 'ctrl+left': {
      const line = content.lines[content.cursorLine] ?? '';
      content.cursorCol = wordStartLeft(line, content.cursorCol);
      return true;
    }
    case 'ctrl+right': {
      const line = content.lines[content.cursorLine] ?? '';
      content.cursorCol = wordEndRight(line, content.cursorCol);
      return true;
    }
    case 'char': {
      const line = content.lines[content.cursorLine] ?? '';
      const next = line.slice(0, content.cursorCol) + key.value + line.slice(content.cursorCol);
      content.lines[content.cursorLine] = next;
      content.cursorCol = graphemeBoundaryAtOrAfter(segmenter, next, content.cursorCol + key.value.length);
      return true;
    }
    default:
      return false;
  }
}

/**
 * Move the caret up by one visual row, in place. Within a wrapped logical line
 * this stays on the same line index but repositions the column. At the first
 * visual row of a logical line, moves to the last visual row of the previous
 * logical line. Returns true (key is always consumed).
 */
export function moveUpVisual(segmenter: IGraphemeSegmenter, content: EditorContent, cols: number, prefixWidth: number): boolean {
  const line = content.lines[content.cursorLine] ?? '';
  const visualPos = prefixWidth + stringWidth(line.slice(0, content.cursorCol));
  const rowInLine = Math.floor(visualPos / cols);
  const colInRow = visualPos % cols;

  if (rowInLine > 0) {
    const targetPos = (rowInLine - 1) * cols + colInRow;
    content.cursorCol = colFromVisual(segmenter, line, Math.max(0, targetPos - prefixWidth));
    return true;
  }

  if (content.cursorLine === 0) {
    return true;
  }

  content.cursorLine--;
  const prevLine = content.lines[content.cursorLine] ?? '';
  const prevTotalVisual = prefixWidth + stringWidth(prevLine);
  const prevRowCount = Math.max(1, Math.ceil(prevTotalVisual / cols));
  const prevTargetPos = Math.min((prevRowCount - 1) * cols + colInRow, prevTotalVisual);
  content.cursorCol = colFromVisual(segmenter, prevLine, Math.max(0, prevTargetPos - prefixWidth));
  return true;
}

/**
 * Move the caret down by one visual row, in place. Within a wrapped logical
 * line this stays on the same line index but repositions the column. At the
 * last visual row of a logical line, moves to the first visual row of the next
 * logical line. Returns true (key is always consumed).
 */
export function moveDownVisual(segmenter: IGraphemeSegmenter, content: EditorContent, cols: number, prefixWidth: number): boolean {
  const line = content.lines[content.cursorLine] ?? '';
  const visualPos = prefixWidth + stringWidth(line.slice(0, content.cursorCol));
  const rowInLine = Math.floor(visualPos / cols);
  const colInRow = visualPos % cols;
  const totalVisual = prefixWidth + stringWidth(line);
  const totalRows = Math.max(1, Math.ceil(totalVisual / cols));

  if (rowInLine < totalRows - 1) {
    const targetPos = Math.min((rowInLine + 1) * cols + colInRow, totalVisual);
    content.cursorCol = colFromVisual(segmenter, line, Math.max(0, targetPos - prefixWidth));
    return true;
  }

  if (content.cursorLine >= content.lines.length - 1) {
    return true;
  }

  content.cursorLine++;
  const nextLine = content.lines[content.cursorLine] ?? '';
  content.cursorCol = colFromVisual(segmenter, nextLine, Math.max(0, colInRow - prefixWidth));
  return true;
}
