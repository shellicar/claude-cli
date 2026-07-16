/** Resolves a possibly-negative after_line against the file's lines, Python-index style:
 *  -1 is after the last line, -2 after the second-last, and so on.
 *
 *  `split('\n')` always yields one more element than there are newlines, and that last
 *  element is '' whenever the content ends with a trailing newline — a terminator
 *  artifact, not a real line. Left uncorrected, a negative index resolves past it and
 *  inserts after that phantom, producing a spurious extra blank line. Negative indices
 *  are resolved against the line count with that phantom excluded; explicit non-negative
 *  after_line values (bounds, addressing) are untouched and still match what Read reports. */
export function resolveAfterLine(afterLine: number, lines: string[]): number {
  const total = lines.length;
  const trailingNewline = total > 0 && lines[total - 1] === '';
  const lastRealLine = trailingNewline ? total - 1 : total;
  const resolved = afterLine < 0 ? lastRealLine + afterLine + 1 : afterLine;
  if (resolved < 0 || resolved > total) {
    throw new Error(`insert after_line ${afterLine} out of bounds (file has ${total} lines)`);
  }
  return resolved;
}
