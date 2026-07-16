/** Resolves a possibly-negative after_line against the file's line count, Python-index style:
 *  -1 is after the last line, -2 after the second-last, and so on. */
export function resolveAfterLine(afterLine: number, total: number): number {
  const resolved = afterLine < 0 ? total + afterLine + 1 : afterLine;
  if (resolved < 0 || resolved > total) {
    throw new Error(`insert after_line ${afterLine} out of bounds (file has ${total} lines)`);
  }
  return resolved;
}
