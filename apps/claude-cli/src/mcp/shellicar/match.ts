import { segmentMatch } from './segmentMatch';

export function match(path: string[], pi: number, pat: string[], gi: number): boolean {
  // Both exhausted — match
  if (pi === path.length && gi === pat.length) {
    return true;
  }
  // Pattern exhausted but path remains — no match
  if (gi === pat.length) {
    return false;
  }

  const segment = pat[gi];

  // ** matches zero or more path segments
  if (segment === '**') {
    // Try matching ** against 0, 1, 2, ... path segments
    for (let skip = 0; skip <= path.length - pi; skip++) {
      if (match(path, pi + skip, pat, gi + 1)) {
        return true;
      }
    }
    return false;
  }

  // Path exhausted but non-** pattern remains — no match
  if (pi === path.length) {
    return false;
  }

  // * matches any single segment, literal must match exactly
  if (segment === '*' || segmentMatch(path[pi], segment)) {
    return match(path, pi + 1, pat, gi + 1);
  }

  return false;
}
