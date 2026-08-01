import { compilePathPattern, pathSegments } from './pathPattern.js';

/**
 * One segment's pattern against one segment, where `*` matches any run of characters that does not
 * cross a `/` — and it cannot cross one, because a segment has none.
 *
 * The walk is the same shape as the segment walk below, one level down: advance while the two
 * agree, and on a disagreement return to the most recent `*` and let it swallow one more character.
 * Since each retry gives the wildcard exactly one more character and never revisits an earlier
 * choice, the work is bounded by pattern length times segment length. Compiling this to
 * `[^/]*a[^/]*a[^/]*` instead would put unbounded quantifiers next to each other and make a
 * near-miss exponential.
 */
function segmentMatches(pattern: string, segment: string): boolean {
  let patternIndex = 0;
  let charIndex = 0;
  let lastWildcard = -1;
  let charAfterWildcard = 0;

  while (charIndex < segment.length) {
    const patternChar = pattern[patternIndex];

    if (patternChar === '*') {
      lastWildcard = patternIndex;
      charAfterWildcard = charIndex;
      patternIndex++;
      continue;
    }

    if (patternIndex < pattern.length && patternChar === segment[charIndex]) {
      patternIndex++;
      charIndex++;
      continue;
    }

    if (lastWildcard === -1) {
      return false;
    }

    // Hand the wildcard one more character and resume from just after it.
    patternIndex = lastWildcard + 1;
    charAfterWildcard++;
    charIndex = charAfterWildcard;
  }

  // Any wildcards left over match nothing, which is fine; anything else is unmatched pattern.
  while (pattern[patternIndex] === '*') {
    patternIndex++;
  }
  return patternIndex === pattern.length;
}

/**
 * Does this path fall under this pattern?
 *
 * Both sides are reduced to segments first (see `compilePathPattern`), so the only thing that can
 * consume a variable number of them is `**`. Everything else matches one segment against one
 * segment, which either holds or does not.
 *
 * That leaves `**` as the single place the walk can go wrong, and it is handled the standard way:
 * remember where the most recent `**` was, and when a later segment fails to match, go back and let
 * that `**` absorb one more segment. Every retry consumes one more of the path and never
 * reconsiders an earlier `**`, so the work is bounded by pattern segments times path segments
 * however many `**` a pattern contains — no engine's backtracking behaviour to reason about.
 */
/** macOS and Windows are case-insensitive by default, so `/Users/x/.ssh` and `/users/x/.ssh` are
 *  one file and a rule about one has to cover the other. Every other platform Node runs on is
 *  case-sensitive, where `src` and `SRC` really are different directories. */
const foldsCase = (platform: NodeJS.Platform): boolean => platform === 'darwin' || platform === 'win32';

export function matchesPath(pattern: string, path: string, cwd: string, home: string, platform: NodeJS.Platform = 'linux'): boolean {
  if (pattern === '*') {
    return true;
  }

  const fold = (segment: string): string => (foldsCase(platform) ? segment.toLowerCase() : segment);
  const patternSegments = compilePathPattern(pattern, cwd, home).map(fold);
  const actualSegments = pathSegments(path, cwd, home).map(fold);

  let patternIndex = 0;
  let pathIndex = 0;
  let lastDoubleStar = -1;
  let pathIndexAfterDoubleStar = 0;

  while (pathIndex < actualSegments.length) {
    const patternSegment = patternSegments[patternIndex];

    if (patternSegment === '**') {
      lastDoubleStar = patternIndex;
      pathIndexAfterDoubleStar = pathIndex;
      patternIndex++;
      continue;
    }

    if (patternSegment !== undefined && segmentMatches(patternSegment, actualSegments[pathIndex] as string)) {
      patternIndex++;
      pathIndex++;
      continue;
    }

    if (lastDoubleStar === -1) {
      return false;
    }

    // Hand the `**` one more segment and resume from just after it.
    patternIndex = lastDoubleStar + 1;
    pathIndexAfterDoubleStar++;
    pathIndex = pathIndexAfterDoubleStar;
  }

  // A trailing `**` is allowed to absorb nothing at all, which is what makes `$PWD/**` match
  // `$PWD` itself.
  while (patternSegments[patternIndex] === '**') {
    patternIndex++;
  }
  return patternIndex === patternSegments.length;
}
