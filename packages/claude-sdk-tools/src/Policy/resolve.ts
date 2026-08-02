import { matchesInput } from './matchInput.js';
import { matchesPath } from './matchPath.js';
import { matchesTool } from './matchTool.js';
import type { PolicySet, Resolution, Verdict } from './types.js';

export type ResolveInput = {
  tool: string;
  /** The tool's own raw input, untouched \u2014 `resolve` reads named fields out of it generically
   *  (via `matchesInput`), it never assumes a shape of its own. */
  input: unknown;
  /** Every path this call resolves to (already normalised, already extracted by the caller via
   *  the existing isPath/collectPaths mechanism). Each is judged on its own; see `resolve`. */
  paths: string[];
  operation: string;
  cwd: string;
  home: string;
  /** Decides whether path matching folds case, since that is a property of the machine rather than
   *  of the rule. Read through the filesystem abstraction, never from the process directly. */
  platform: NodeJS.Platform;
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

/** One path's verdict: the first rule in the ordered list for which every matcher it names
 *  holds (tool AND input AND this path) AND that actually covers this operation (an operations
 *  entry for it, or its own default) governs completely. A rule that matches but is silent on
 *  this specific operation -- no operations entry for it, no default -- does NOT stop the
 *  search: it falls through to the next matching rule, the same way a rule that doesn't match
 *  at all does. Being silent on an operation is different from deciding ask for it; treating
 *  the two the same would let an earlier, narrower rule (e.g. a path zone that only ever talks
 *  about read/write) silently block a later, more general rule from ever being consulted for an
 *  operation the earlier rule never mentioned. No matching rule anywhere in the list also falls
 *  to Ask -- never a silent Allow.
 *
 *  `path` is undefined for a call that names no paths at all. A rule with a real pattern
 *  ($PWD, ~/.ssh/**) then cannot match: there is nothing to test containment against. The
 *  wildcard (path: '*') is different -- it imposes no real constraint, so it matches anyway,
 *  the same way tool: '*' matches regardless of the tool name. */
function resolveOne(policy: PolicySet, args: ResolveInput, path: string | undefined): Resolution {
  for (const rule of policy) {
    if (!matchesTool(rule.tool, args.tool)) {
      continue;
    }
    if (!matchesInput(rule.input, args.input)) {
      continue;
    }
    if (rule.path != null && rule.path !== '*') {
      if (path === undefined || !matchesPath(rule.path, path, args.cwd, args.home, args.platform)) {
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

const SEVERITY: Record<Verdict, number> = { allow: 0, ask: 1, deny: 2 };

/** The least permissive of several verdicts, carrying its own message. A call is judged more than
 *  once whenever it touches more than one thing: several paths, or an execution that also writes.
 *  Nothing to judge is not the same as judged and permitted. */
export function strictest(resolutions: Resolution[]): Resolution {
  let worst: Resolution | undefined;
  for (const resolution of resolutions) {
    if (worst === undefined || SEVERITY[resolution.verdict] > SEVERITY[worst.verdict]) {
      worst = resolution;
    }
  }
  return worst ?? { verdict: 'ask' };
}

/**
 * A call naming several paths is several calls. Filesystem permissions belong to the objects,
 * not to the request, so each path is resolved on its own -- and the operation is one
 * indivisible act over all of them, so what the caller is asking for is the conjunction:
 * `Delete{a, b}` is not "approve a" and separately "approve b", it is "approve deleting a AND
 * b". A conjunction is only as permissive as its weakest term, so any deny denies the call,
 * else any ask asks, else allow.
 *
 * That is what stops a permitted path from carrying a forbidden one through with it: judging
 * the paths as a set instead would mean adding one innocuous path could change which rules a
 * call matches at all, and a deny carve-out could be escaped by naming a second file beside it.
 *
 * The message returned is the one belonging to the path that actually decided the call, not an
 * arbitrary one -- so a refusal tells the model which target it was refused for.
 */
export function resolve(policy: PolicySet, args: ResolveInput): Resolution {
  if (args.paths.length === 0) {
    return resolveOne(policy, args, undefined);
  }
  return strictest(args.paths.map((path) => resolveOne(policy, args, path)));
}
