export type LineMatch = {
  line: number;   // 1-based line number
  col: number;    // 0-based char offset within the line
  length: number; // match length in chars
};

export function findMatches(lines: string[], pattern: RegExp): LineMatch[] {
  const results: LineMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    const re = new RegExp(pattern.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(lines[i])) !== null) {
      results.push({ line: i + 1, col: match.index, length: match[0].length });
      if (match[0].length === 0) re.lastIndex++;
    }
  }
  return results;
}
