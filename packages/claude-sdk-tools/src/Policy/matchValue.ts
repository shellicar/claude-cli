/** A generic value pattern. Which comparison applies is decided purely by the PATTERN's own
 *  shape \u2014 never by which field it's checking or which tool it came from. A plain list is
 *  membership (the actual value is a scalar, must equal one of these); `allOf`/`anyOf` are for
 *  an actual array value; `suffix` is for an actual scalar. Reused identically whether the
 *  field happens to be called `program`, `args`, or anything else. */
export type ValuePattern = string[] | { allOf: string[] } | { anyOf: string[] } | { suffix: string };

export function matchesValue(pattern: ValuePattern, actual: unknown): boolean {
  if (Array.isArray(pattern)) {
    return typeof actual === 'string' && pattern.includes(actual);
  }
  if ('allOf' in pattern) {
    return Array.isArray(actual) && pattern.allOf.every((v) => actual.includes(v));
  }
  if ('anyOf' in pattern) {
    return Array.isArray(actual) && pattern.anyOf.some((v) => actual.includes(v));
  }
  return typeof actual === 'string' && actual.endsWith(pattern.suffix);
}
