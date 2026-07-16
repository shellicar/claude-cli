/** Resolves a possibly-negative after_line against the file's line count, Python-index style:
 *  -1 is after the last line, -2 after the second-last, and so on. Matches Read's own line
 *  count, including a trailing blank line from a trailing newline \u2014 Read numbers that blank
 *  as a real line, so -1 lands after it here too. */
export function resolveAfterLine(afterLine: number, total: number): number {
  const resolved = afterLine < 0 ? total + afterLine + 1 : afterLine;
  if (resolved < 0 || resolved > total) {
    throw new Error(`insert after_line ${afterLine} out of bounds (file has ${total} lines)`);
  }
  return resolved;
}
