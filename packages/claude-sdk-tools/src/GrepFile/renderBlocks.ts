import type { LineMatch } from './findMatches';
import type { Window } from './mergeWindows';
import { formatContextLine, formatMatchLine } from './formatLine';

export function renderBlocks(lines: string[], windows: Window[], maxLineLength: number): string {
  const blocks: string[] = [];

  for (const window of windows) {
    const matchByLine = new Map<number, LineMatch>();
    for (const m of window.matches) {
      if (!matchByLine.has(m.line)) matchByLine.set(m.line, m);
    }

    const blockLines: string[] = [];
    for (let lineNum = window.start; lineNum <= window.end; lineNum++) {
      const line = lines[lineNum - 1];
      const m = matchByLine.get(lineNum);
      const formatted = m
        ? formatMatchLine(line, m.col, m.length, maxLineLength)
        : formatContextLine(line, maxLineLength);
      blockLines.push(`${String(lineNum).padStart(6)}\t${formatted}`);
    }

    blocks.push(blockLines.join('\n'));
  }

  return blocks.join('\n---\n');
}
