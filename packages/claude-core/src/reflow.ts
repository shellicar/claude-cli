import stringWidth from 'string-width';
import { sanitiseZwj } from './sanitise.js';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

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
  if (segments.length === 0) {
    return [''];
  }

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
 * Matches a single CSI escape sequence: ESC [ <params> <final-letter>.
 * Used to tokenize lines into ANSI runs (zero visible width) and plain text.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences requires \x1b
const ANSI_RE = /\u001b\[[^a-zA-Z]*[a-zA-Z]/g;
/**
 * Splits a logical line into visual rows by wrapping at `columns` visual width.
 * Returns at least one entry (empty string for empty input).
 *
 * ANSI escape sequences are treated as atomic and zero-width: they are buffered
 * until the next visible character determines which wrapped line they belong to,
 * so they always travel with their target character rather than being stranded
 * at a line boundary.
 */
export function wrapLine(line: string, columns: number): string[] {
  const sanitised = sanitiseZwj(line);
  if (stringWidth(sanitised) <= columns) {
    return [sanitised];
  }

  const result: string[] = [];
  let current = '';
  let currentWidth = 0;
  let pendingAnsi = '';

  const placeChar = (segment: string, cw: number) => {
    if (currentWidth + cw > columns) {
      result.push(current);
      current = pendingAnsi + segment;
      pendingAnsi = '';
      currentWidth = cw;
    } else {
      current += pendingAnsi + segment;
      pendingAnsi = '';
      currentWidth += cw;
    }
  };

  let lastIndex = 0;
  for (const match of sanitised.matchAll(ANSI_RE)) {
    // Process any plain text before this ANSI sequence.
    for (const { segment } of segmenter.segment(sanitised.slice(lastIndex, match.index))) {
      placeChar(segment, stringWidth(segment));
    }
    // Buffer the ANSI sequence — it will prepend whatever comes next.
    pendingAnsi += match[0];
    lastIndex = match.index + match[0].length;
  }

  // Process any remaining plain text after the last ANSI sequence.
  for (const { segment } of segmenter.segment(sanitised.slice(lastIndex))) {
    placeChar(segment, stringWidth(segment));
  }

  // Any trailing ANSI sequences with no following visible text go on the last line.
  current += pendingAnsi;

  if (current.length > 0 || result.length === 0) {
    result.push(current);
  }
  return result;
}
