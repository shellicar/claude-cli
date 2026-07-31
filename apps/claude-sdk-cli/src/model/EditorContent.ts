/**
 * The editor's data: lines of text and a cursor. No behaviour, no dependencies,
 * no events. Transitions take this type and mutate it in place.
 */
export type EditorContent = {
  lines: string[];
  cursorLine: number;
  cursorCol: number;
};

/**
 * The same value seen through a narrower type, for readers that must not write.
 * `EditorContent` is assignable to this, so one value serves both.
 *
 * A compile-time promise only. JS has no ownership: this is the same object the
 * transitions mutate, erased at runtime, so it is not a snapshot. Anything that
 * needs to keep a value across a later edit must copy it.
 */
export type ReadonlyEditorContent = {
  readonly lines: readonly string[];
  readonly cursorLine: number;
  readonly cursorCol: number;
};

/**
 * Builds content, copying the lines so the caller's array does not become the
 * editor's buffer, and clamping the cursor into the lines it was given.
 *
 * The clamp is the only validation there is. Past construction the fields are
 * mutable by design, so the transitions assume the cursor is in bounds rather
 * than defend against it: content is trusted.
 */
export function createEditorContent(initial?: ReadonlyEditorContent): EditorContent {
  if (!initial) {
    return { lines: [''], cursorLine: 0, cursorCol: 0 };
  }
  const lines = initial.lines.length > 0 ? [...initial.lines] : [''];
  const cursorLine = Math.min(Math.max(initial.cursorLine, 0), lines.length - 1);
  const cursorCol = Math.min(Math.max(initial.cursorCol, 0), (lines[cursorLine] ?? '').length);
  return { lines, cursorLine, cursorCol };
}

/** Full text content — all lines joined by newline. */
export function editorText(content: ReadonlyEditorContent): string {
  return content.lines.join('\n');
}
