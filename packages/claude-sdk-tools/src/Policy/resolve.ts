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
   *  the existing `isPath`/`collectPaths` mechanism). A `path`-scoped rule matches only when
   *  there is at least one, and it covers all of them \u2014 empty means the rule can never match,
   *  not that it matches vacuously. */
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
 *  names holds (`tool` AND `input` AND `path`) governs completely \u2014 its own `operations`
 *  entry for this operation, else its own `default`, else `Ask`. No match anywhere in the
 *  list also falls to `Ask` \u2014 never a silent `Allow`. */
export function resolve(policy: PolicySet, args: ResolveInput): Resolution {
  for (const rule of policy) {
    if (!matchesTool(rule.tool, args.tool)) {
      continue;
    }
    if (!matchesInput(rule.input, args.input)) {
      continue;
    }
    if (rule.path != null) {
      if (args.paths.length === 0 || !args.paths.every((p) => matchesPath(rule.path as string, p, args.cwd, args.home))) {
        continue;
      }
    }
    const verdict = rule.operations?.[args.operation] ?? rule.default ?? 'ask';
    const message = interpolateMessage(rule.message, args.input);
    return message != null ? { verdict, message } : { verdict };
  }
  return { verdict: 'ask' };
}
