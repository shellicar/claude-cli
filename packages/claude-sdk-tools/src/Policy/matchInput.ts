import { ruleConfigMatches } from '../Exec/ruleConfig.js';
import type { RuleConfig } from '../Exec/ruleConfig.js';

function isMatchableCommand(input: unknown): input is { program: string; args?: string[] } {
  return typeof input === 'object' && input != null && typeof (input as Record<string, unknown>).program === 'string';
}

/** Concern 2, isolated: reuses `RuleConfig` (`Exec/ruleConfig.ts`) verbatim \u2014 nothing new
 *  invented \u2014 tested against whatever the tool's own input happens to expose. Duck-typed,
 *  never tool-aware: any tool whose input structurally carries a `program` field (and
 *  optionally `args`) is command-matchable, regardless of which tool it is or why it has that
 *  shape. A tool with no `program` field can never match an `input` rule at all. */
export function matchesInput(matcher: RuleConfig | undefined, input: unknown): boolean {
  if (matcher == null) {
    return true;
  }
  if (!isMatchableCommand(input)) {
    return false;
  }
  return ruleConfigMatches({ program: input.program, args: input.args ?? [] }, matcher);
}
