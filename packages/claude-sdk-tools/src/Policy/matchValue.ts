import { normaliseArgs } from '../normaliseArgs.js';

/** A generic value pattern. Which comparison applies is decided purely by the PATTERN's own
 *  shape - never by which field it's checking or which tool it came from. A plain list is a
 *  shorthand: against a scalar actual value it's membership (the actual equals one of these);
 *  against an array actual value it's equivalent to anyOf (the actual contains one of these).
 *  allOf/anyOf/suffix/maxLength can combine freely in one object - every one that's present
 *  must hold, not just whichever is checked first. basename strips any path prefix off a
 *  scalar before comparing - deliberately its own opt-in shape, not applied unconditionally: a
 *  field that happens to contain a '/' for unrelated reasons (a branch name, a URL) must never
 *  have it silently stripped, only a field the rule author has decided is path-shaped.
 *  allOf/anyOf normalise an array of string tokens the same way ruleConfigMatches already does
 *  (--foo=bar -> --foo, a bundled short flag -ni also matches -i) - a real, load-bearing
 *  CLI-argument convention, not a simplification. Reused identically whether the field happens
 *  to be called program, args, or anything else. */
export type ValuePattern = string[] | { allOf?: string[]; anyOf?: string[]; suffix?: string; basename?: string[]; maxLength?: number };

function basename(value: string): string {
  const idx = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return idx === -1 ? value : value.slice(idx + 1);
}

/** A set of name/value pairs is matched by its names, so `Program.env` is reachable by the same
 *  patterns everything else uses: `{ anyOf: ['GIT_SSH_COMMAND'] }` denies a call that sets it.
 *  Values are deliberately not matched — a variable of that kind is worth refusing whatever it is
 *  set to, and the ones worth allowing are harmless whatever they are set to. */
function asMatchable(actual: unknown): unknown {
  return typeof actual === 'object' && actual != null && !Array.isArray(actual) ? Object.keys(actual as Record<string, unknown>) : actual;
}

export function matchesValue(pattern: ValuePattern, value: unknown): boolean {
  const actual = asMatchable(value);
  if (Array.isArray(pattern)) {
    if (typeof actual === 'string') {
      return pattern.includes(actual);
    }
    // Normalised the same way `anyOf` is: the shorthand is documented as meaning `anyOf`, and a
    // shorthand that quietly matched less than the form it stands for would be the trap the
    // documentation prevents.
    return Array.isArray(actual) && pattern.some((v) => normaliseArgs(actual as string[]).includes(v));
  }
  if (pattern.allOf || pattern.anyOf) {
    if (!Array.isArray(actual)) {
      return false;
    }
    const flags = normaliseArgs(actual as string[]);
    if (pattern.allOf && !pattern.allOf.every((v) => flags.includes(v))) {
      return false;
    }
    if (pattern.anyOf && !pattern.anyOf.some((v) => flags.includes(v))) {
      return false;
    }
  }
  if (pattern.maxLength != null && !(Array.isArray(actual) && actual.length <= pattern.maxLength)) {
    return false;
  }
  if (pattern.suffix && !(typeof actual === 'string' && actual.endsWith(pattern.suffix))) {
    return false;
  }
  if (pattern.basename && !(typeof actual === 'string' && pattern.basename.includes(basename(actual)))) {
    return false;
  }
  return pattern.allOf != null || pattern.anyOf != null || pattern.suffix != null || pattern.basename != null || pattern.maxLength != null;
}
