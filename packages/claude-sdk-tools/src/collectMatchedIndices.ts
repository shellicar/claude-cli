/**
 * Returns a sorted array of line indices that match the regex, expanded by
 * `context` lines on either side.
 */
export function collectMatchedIndices(lines: string[], regex: RegExp, context: number): number[] {
  const matchedIndices = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      const start = Math.max(0, i - context);
      const end = Math.min(lines.length - 1, i + context);
      for (let j = start; j <= end; j++) {
        matchedIndices.add(j);
      }
    }
  }
  return [...matchedIndices].sort((a, b) => a - b);
}
