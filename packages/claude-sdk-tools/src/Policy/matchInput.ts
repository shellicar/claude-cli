import type { ValuePattern } from './matchValue.js';
import { matchesValue } from './matchValue.js';

/** Names real fields of a tool's own input, verbatim \u2014 `program` names `input.program`,
 *  `args` names `input.args`, whatever the tool actually calls them. No translation layer:
 *  the engine never maps a rule vocabulary onto a tool's schema, it reads the tool's own
 *  field names straight out of the rule. */
export type InputMatcher = Record<string, ValuePattern>;

/** Concern 2, isolated: every named field must be present in the real input AND match its
 *  pattern. Operates on the tool's raw input directly \u2014 genuinely generic, since it never
 *  hardcodes a field name anywhere in code, only reads whichever keys the rule itself names. */
export function matchesInput(matcher: InputMatcher | undefined, input: unknown): boolean {
  if (matcher == null) {
    return true;
  }
  if (typeof input !== 'object' || input == null) {
    return false;
  }
  const record = input as Record<string, unknown>;
  return Object.entries(matcher).every(([key, pattern]) => matchesValue(pattern, record[key]));
}
