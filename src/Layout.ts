import stringWidth from 'string-width';
import type { EditorRender } from './renderer.js';
import { sanitiseZwj } from './sanitise.js';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

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
 * A run of consecutive graphemes with the same character width.
 * Pre-computed on append to enable arithmetic-based re-wrapping on resize
 * without re-running Intl.Segmenter.
 */
export interface LineSegment {
  text: string;
  totalWidth: number;
  charWidth: number;
  count: number;
}

/**
 * Decomposes a line into grouped segments by running Intl.Segmenter once.
 * Consecutive graphemes with the same character width are merged into one segment.
 */
export function computeLineSegments(line: string): LineSegment[] {
  const sanitised = sanitiseZwj(line);
  const result: LineSegment[] = [];
  let segStart = 0;
  let charPos = 0;
  let currentTotalWidth = 0;
  let currentCharWidth = -1;
  let count = 0;

  for (const { segment } of segmenter.segment(sanitised)) {
    const cw = stringWidth(segment);
    if (currentCharWidth === -1) {
      currentCharWidth = cw;
    }
    if (cw !== currentCharWidth) {
      result.push({ text: sanitised.slice(segStart, charPos), totalWidth: currentTotalWidth, charWidth: currentCharWidth, count });
      segStart = charPos;
      currentTotalWidth = cw;
      currentCharWidth = cw;
      count = 1;
    } else {
      currentTotalWidth += cw;
      count++;
    }
    charPos += segment.length;
  }
  if (currentCharWidth !== -1) {
    result.push({ text: sanitised.slice(segStart, charPos), totalWidth: currentTotalWidth, charWidth: currentCharWidth, count });
  }
  return result;
}

/**
 * Re-wraps a pre-segmented line at a new column width using arithmetic only.
 * No Intl.Segmenter calls for width-1 segments (the common case).
 */
export function rewrapFromSegments(segments: LineSegment[], columns: number): string[] {
  if (segments.length === 0) { return ['']; }

  const result: string[] = [];
  let current = '';
  let currentWidth = 0;

  for (const seg of segments) {
    if (seg.charWidth === 0) {
      current += seg.text;
      continue;
    }

    if (currentWidth + seg.totalWidth <= columns) {
      current += seg.text;
      currentWidth += seg.totalWidth;
    } else if (seg.charWidth === 1) {
      // Use slice for bulk splitting: O(n/columns) operations instead of O(n)
      let tail = seg.text;
      let tailWidth = seg.totalWidth;
      const fits = columns - currentWidth;
      if (fits > 0) {
        current += tail.slice(0, fits);
        tail = tail.slice(fits);
        tailWidth -= fits;
      }
      result.push(current);
      current = '';
      currentWidth = 0;
      while (tailWidth > columns) {
        result.push(tail.slice(0, columns));
        tail = tail.slice(columns);
        tailWidth -= columns;
      }
      current = tail;
      currentWidth = tailWidth;
    } else {
      for (const { segment } of segmenter.segment(seg.text)) {
        const cw = seg.charWidth;
        if (currentWidth + cw > columns) {
          result.push(current);
          current = segment;
          currentWidth = cw;
        } else {
          current += segment;
          currentWidth += cw;
        }
      }
    }
  }

  if (current.length > 0 || result.length === 0) {
    result.push(current);
  }
  return result;
}

/**
 * Splits a logical line into visual rows by wrapping at `columns` visual width.
 * Returns at least one entry (empty string for empty input).
 */
export function wrapLine(line: string, columns: number): string[] {
  const sanitised = sanitiseZwj(line);
  if (stringWidth(sanitised) <= columns) {
    return [sanitised];
  }
  const segments: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const { segment } of segmenter.segment(sanitised)) {
    const cw = stringWidth(segment);
    if (currentWidth + cw > columns) {
      segments.push(current);
      current = segment;
      currentWidth = cw;
    } else {
      current += segment;
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
