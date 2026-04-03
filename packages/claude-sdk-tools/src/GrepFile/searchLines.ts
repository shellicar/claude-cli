import { findMatches } from './findMatches';
import { buildWindows, mergeWindows } from './mergeWindows';
import { renderBlocks } from './renderBlocks';

export type SearchOptions = {
  skip: number;
  limit: number;
  context: number;
  maxLineLength: number;
};

export type SearchResult = {
  matchCount: number;
  content: string;
};

export function searchLines(lines: string[], pattern: RegExp, options: SearchOptions): SearchResult {
  const matches = findMatches(lines, pattern);
  const page = matches.slice(options.skip, options.skip + options.limit);
  const windows = mergeWindows(buildWindows(page, options.context, lines.length));
  const content = renderBlocks(lines, windows, options.maxLineLength);
  return { matchCount: matches.length, content };
}
