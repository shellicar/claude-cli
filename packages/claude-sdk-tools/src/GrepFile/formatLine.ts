const ELLIPSIS = '…';

export function formatMatchLine(line: string, col: number, matchLength: number, maxLength: number): string {
  if (line.length <= maxLength) return line;

  const matchEnd = col + matchLength;
  const center = Math.floor((col + matchEnd) / 2);
  const half = Math.floor(maxLength / 2);

  let start = Math.max(0, center - half);
  const end = Math.min(line.length, start + maxLength);
  if (end - start < maxLength) {
    start = Math.max(0, end - maxLength);
  }

  const prefix = start > 0 ? ELLIPSIS : '';
  const suffix = end < line.length ? ELLIPSIS : '';

  return `${prefix}${line.slice(start, end)}${suffix}`;
}

export function formatContextLine(line: string, maxLength: number): string {
  if (line.length <= maxLength) return line;
  return `${line.slice(0, maxLength)}${ELLIPSIS}`;
}
