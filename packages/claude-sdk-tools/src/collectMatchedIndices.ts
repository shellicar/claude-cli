/**
 * Returns a sorted array of line indices that match the regex, expanded by
 * `before` lines above and `after` lines below each match (grep's -B / -A).
 */
export function collectMatchedIndices(lines: string[], regex: RegExp, before: number, after: number): number[] {
  const matchedIndices = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      const start = Math.max(0, i - before);
      const end = Math.min(lines.length - 1, i + after);
      for (let j = start; j <= end; j++) {
        matchedIndices.add(j);
      }
    }
  }
  return [...matchedIndices].sort((a, b) => a - b);
}
