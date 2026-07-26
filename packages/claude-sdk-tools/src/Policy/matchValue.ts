/** A generic value pattern. Which comparison applies is decided purely by the PATTERN's own
 *  shape \u2014 never by which field it's checking or which tool it came from. A plain list is a
 *  shorthand: against a scalar actual value it's membership (the actual equals one of these);
 *  against an array actual value it's equivalent to `anyOf` (the actual contains one of these).
 *  `allOf`/`anyOf`/`suffix` can combine freely in one object \u2014 every one that's present must
 *  hold, not just whichever is checked first. Reused identically whether the field happens to
 *  be called `program`, `args`, or anything else. */
export type ValuePattern = string[] | { allOf?: string[]; anyOf?: string[]; suffix?: string };

export function matchesValue(pattern: ValuePattern, actual: unknown): boolean {
  if (Array.isArray(pattern)) {
    if (typeof actual === 'string') {
      return pattern.includes(actual);
    }
    return Array.isArray(actual) && pattern.some((v) => actual.includes(v));
  }
  if (pattern.allOf && !(Array.isArray(actual) && pattern.allOf.every((v) => actual.includes(v)))) {
    return false;
  }
  if (pattern.anyOf && !(Array.isArray(actual) && pattern.anyOf.some((v) => actual.includes(v)))) {
    return false;
  }
  if (pattern.suffix && !(typeof actual === 'string' && actual.endsWith(pattern.suffix))) {
    return false;
  }
  return pattern.allOf != null || pattern.anyOf != null || pattern.suffix != null;
}
