import { matchesInput } from './matchInput.js';
import { matchesPath } from './matchPath.js';
import { matchesTool } from './matchTool.js';
import type { PolicySet, Resolution } from './types.js';

export type ResolveInput = {
  tool: string;
  /** The tool's own raw input, untouched \u2014 `resolve` reads named fields out of it generically
   *  (via `matchesInput`), it never assumes a shape of its own. */
  input: unknown;
  /** Every path this call resolves to (already normalised, already extracted by the caller via
   *  the existing isPath/collectPaths mechanism). A path-scoped rule with a REAL pattern
   *  ($PWD, ~/.ssh/**, etc.) matches only when there is at least one path, and it covers all of
   *  them -- empty means that rule can never match, since there's nothing to test containment
   *  against. The wildcard (path: '*') is different: it imposes no real constraint at all, so
   *  it always matches regardless of paths, the same way tool: '*' always matches regardless
   *  of the tool name -- an empty list must not defeat the one rule meant to catch everything. */
  paths: string[];
  operation: string;
  cwd: string;
  home: string;
};

/** `{key}` \u2192 `input[key]`, for whichever fields the real input happens to carry \u2014 generic
 *  the same way `matchesInput` is: no field name is ever known ahead of time. */
function interpolateMessage(message: string | undefined, input: unknown): string | undefined {
  if (message == null) {
    return undefined;
  }
  const record = typeof input === 'object' && input != null ? (input as Record<string, unknown>) : {};
  return message.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = record[key];
    return typeof value === 'string' ? value : whole;
  });
}

/** Concern 4 + 5, combined: the first rule in the ordered list for which every matcher it
 *  names holds (tool AND input AND path) AND that actually covers this operation (an
 *  operations entry for it, or its own default) governs completely. A rule that matches but
 *  is silent on this specific operation -- no operations entry for it, no default -- does NOT
 *  stop the search: it falls through to the next matching rule, the same way a rule that
 *  doesn't match at all does. Being silent on an operation is different from deciding ask for
 *  it; treating the two the same would let an earlier, narrower rule (e.g. a path zone that
 *  only ever talks about read/write) silently block a later, more general rule from ever
 *  being consulted for an operation the earlier rule never mentioned. No matching rule
 *  anywhere in the list also falls to Ask -- never a silent Allow. */
export function resolve(policy: PolicySet, args: ResolveInput): Resolution {
  for (const rule of policy) {
    if (!matchesTool(rule.tool, args.tool)) {
      continue;
    }
    if (!matchesInput(rule.input, args.input)) {
      continue;
    }
    if (rule.path != null && rule.path !== '*') {
      if (args.paths.length === 0 || !args.paths.every((p) => matchesPath(rule.path as string, p, args.cwd, args.home))) {
        continue;
      }
    }
    const verdict = rule.operations?.[args.operation] ?? rule.default;
    if (verdict == null) {
      continue;
    }
    const message = interpolateMessage(rule.message, args.input);
    return message != null ? { verdict, message } : { verdict };
  }
  return { verdict: 'ask' };
}
