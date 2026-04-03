import type { LineMatch } from './findMatches';

export type Window = {
  start: number;       // 1-based first line
  end: number;         // 1-based last line
  matches: LineMatch[];
};

export function buildWindows(matches: LineMatch[], context: number, totalLines: number): Window[] {
  return matches.map((m) => ({
    start: Math.max(1, m.line - context),
    end: Math.min(totalLines, m.line + context),
    matches: [m],
  }));
}

export function mergeWindows(windows: Window[]): Window[] {
  if (windows.length === 0) return [];

  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const merged: Window[] = [{ ...sorted[0], matches: [...sorted[0].matches] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end + 1) {
      last.end = Math.max(last.end, current.end);
      last.matches = [...last.matches, ...current.matches];
    } else {
      merged.push({ ...current, matches: [...current.matches] });
    }
  }

  return merged;
}
