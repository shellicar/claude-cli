/** A generic value pattern. Which comparison applies is decided purely by the PATTERN's own
 *  shape \u2014 never by which field it's checking or which tool it came from. A plain list is a
 *  shorthand: against a scalar actual value it's membership (the actual equals one of these);
 *  against an array actual value it's equivalent to `anyOf` (the actual contains one of these).
 *  `allOf`/`anyOf`/`suffix` can combine freely in one object \u2014 every one that's present must
 *  hold, not just whichever is checked first. `basename` strips any path prefix off a scalar
 *  before comparing \u2014 deliberately its own opt-in shape, not applied unconditionally: a field
 *  that happens to contain a `/` for unrelated reasons (a branch name, a URL) must never have
 *  it silently stripped, only a field the rule author has decided is path-shaped. Reused
 *  identically whether the field happens to be called `program`, `args`, or anything else. */
export type ValuePattern = string[] | { allOf?: string[]; anyOf?: string[]; suffix?: string; basename?: string[] };

function basename(value: string): string {
  const idx = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return idx === -1 ? value : value.slice(idx + 1);
}

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
  if (pattern.basename && !(typeof actual === 'string' && pattern.basename.includes(basename(actual)))) {
    return false;
  }
  return pattern.allOf != null || pattern.anyOf != null || pattern.suffix != null || pattern.basename != null;
}
