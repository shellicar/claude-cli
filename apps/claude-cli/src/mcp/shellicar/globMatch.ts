import { match } from './match';

/**
 * Simple glob matcher supporting * (single segment) and ** (any depth).
 * Handles the subset of globs needed for path matching, with no dependencies.
 */
export function globMatch(path: string, pattern: string): boolean {
  const pathParts = path.split('/').filter(Boolean);
  const patParts = pattern.split('/').filter(Boolean);

  return match(pathParts, 0, patParts, 0);
}
