import stringWidth from 'string-width';
import type { IGraphemeSegmenter } from './IGraphemeSegmenter.js';

// Bounded window (in code units) segmented around an insertion point, instead of the whole line, so a
// keystroke's cost does not grow with the line's length — pasted text otherwise arrives as one 'char'
// KeyAction per character (no bracketed-paste batching), each one re-segmenting everything typed so
// far, making a paste of n characters cost O(n^2). Generous enough to contain any realistic grapheme
// cluster (a combining-mark chain, a flag/ZWJ emoji sequence) while staying a small constant; see
// editorTransitions.spec.ts's "long line" cases for the correctness contract this relies on.
export const GRAPHEME_WINDOW = 32;

/**
 * Returns the largest code-unit offset in `line` such that the visual width
 * of `line.slice(0, offset)` does not exceed `targetVisual` columns.
 * Clamps to `line.length` when `targetVisual` exceeds the line's full width.
 */
export function colFromVisual(segmenter: IGraphemeSegmenter, line: string, targetVisual: number): number {
  if (targetVisual <= 0) {
    return 0;
  }
  let w = 0;
  for (const { segment, index } of segmenter.segment(line)) {
    const sw = stringWidth(segment);
    if (w + sw > targetVisual) {
      return index;
    }
    w += sw;
  }
  return line.length;
}

/**
 * Returns the code-unit position of the grapheme boundary immediately before
 * `pos`. Moves back by one grapheme cluster, so moving left through a
 * 2-code-unit emoji jumps to its start rather than landing mid-surrogate.
 */
export function graphemeBoundaryBefore(segmenter: IGraphemeSegmenter, line: string, pos: number): number {
  let boundary = 0;
  for (const { segment, index } of segmenter.segment(line)) {
    const end = index + segment.length;
    if (end >= pos) {
      return index;
    }
    boundary = index;
  }
  return boundary;
}

/**
 * Returns the code-unit position after the grapheme cluster that starts at
 * `pos`. Advances by one grapheme cluster, so moving right through a
 * 2-code-unit emoji jumps to the character after it.
 */
export function graphemeBoundaryAfter(segmenter: IGraphemeSegmenter, line: string, pos: number): number {
  for (const { segment, index } of segmenter.segment(line)) {
    if (index === pos) {
      return index + segment.length;
    }
  }
  // Fallback: advance one code unit (should not happen with well-formed text).
  return pos + 1;
}

/**
 * Snaps `pos` forward to the nearest grapheme boundary at or after it. When an
 * insert merges with a following combining mark into one cluster (typing 'e'
 * before an orphan U+0301 makes "é"), the raw code-unit offset can land inside
 * that cluster; this moves it to the cluster's end so the caret always rests on
 * a boundary. Segments only a small window around `pos`, not the whole line
 * (see GRAPHEME_WINDOW) — a merge can only ever pull in a few neighbouring code
 * units, never something arbitrarily far away.
 */
export function graphemeBoundaryAtOrAfter(segmenter: IGraphemeSegmenter, line: string, pos: number): number {
  const windowStart = Math.max(0, pos - GRAPHEME_WINDOW);
  const windowEnd = Math.min(line.length, pos + GRAPHEME_WINDOW);
  let candidate: number | null = null;
  for (const { segment, index } of segmenter.segment(line.slice(windowStart, windowEnd))) {
    const absoluteIndex = windowStart + index;
    if (absoluteIndex >= pos) {
      candidate = absoluteIndex;
      break;
    }
    if (absoluteIndex + segment.length > pos) {
      candidate = absoluteIndex + segment.length;
      break;
    }
  }
  candidate ??= windowEnd;
  // A candidate landing exactly at windowEnd, when the window stops short of the line's true end, is not
  // trustworthy: segmenting a truncated slice can only ever get the LAST segment wrong (an extremely long
  // cluster — a huge combining-mark chain, or a heavily-modified ZWJ sequence — reaching past the window
  // looks, from inside the slice, exactly like a segment that legitimately ends at the cut point). Every
  // earlier segment is unaffected, since its boundary was decided entirely by code units already present
  // in the slice. Re-verify with a full-line scan only in that one ambiguous case, rather than guess.
  if (candidate === windowEnd && windowEnd < line.length) {
    for (const { segment, index } of segmenter.segment(line)) {
      if (index >= pos) {
        return index;
      }
      if (index + segment.length > pos) {
        return index + segment.length;
      }
    }
    return line.length;
  }
  return candidate;
}
