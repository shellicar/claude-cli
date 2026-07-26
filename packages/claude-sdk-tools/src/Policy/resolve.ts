import { matchesInput } from './matchInput.js';
import { matchesPath } from './matchPath.js';
import { matchesTool } from './matchTool.js';
import type { PolicySet, Resolution } from './types.js';

export type ResolveInput = {
  tool: string;
  input: unknown;
  /** Every path this call resolves to (already normalised). A `path`-scoped rule matches only
   *  when there is at least one, and it covers all of them \u2014 empty means the rule can never
   *  match, not that it matches vacuously. */
  paths: string[];
  operation: string;
  cwd: string;
  home: string;
};

function interpolateMessage(message: string | undefined, input: unknown): string | undefined {
  if (message == null) {
    return undefined;
  }
  const program = typeof input === 'object' && input != null ? (input as Record<string, unknown>).program : undefined;
  return typeof program === 'string' ? message.replaceAll('{program}', program) : message;
}

/** Concern 4 + 5, combined: the first rule in the ordered list for which every matcher it
 *  names holds (`tool` AND `input` AND `path`) governs completely \u2014 its own `operations`
 *  entry for this operation, else its own `default`, else `Ask`. No match anywhere in the
 *  list also falls to `Ask` \u2014 never a silent `Allow`. The message the model sees is the
 *  rule's own, falling back to its `input` matcher's message (an `input`-shaped rule migrated
 *  from `RuleConfig` carries its message for free), interpolating `{program}` the same way
 *  `ruleConfigMatches` already does. */
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
    const message = interpolateMessage(rule.message ?? rule.input?.message, args.input);
    return message != null ? { verdict, message } : { verdict };
  }
  return { verdict: 'ask' };
}
