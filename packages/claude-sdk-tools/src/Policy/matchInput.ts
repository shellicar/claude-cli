import { ruleConfigMatches } from '../Exec/ruleConfig.js';
import type { RuleConfig } from '../Exec/ruleConfig.js';

/** A command value, already extracted from whatever tool produced it \u2014 this module never
 *  looks inside a raw tool input or assumes a field is called `program`/`args`. Extraction is
 *  the caller's job (the same way `collectPaths` extracts `paths` before `resolve` ever sees
 *  them), so a tool can expose this however its own schema names things. */
export type Command = { program: string; args: string[] };

/** Concern 2, isolated: reuses `RuleConfig` (`Exec/ruleConfig.ts`) verbatim \u2014 nothing new
 *  invented. Operates only on an already-extracted `Command`, never on a tool's raw input, so
 *  it carries zero knowledge of which tool it came from or what that tool calls its fields. A
 *  tool call with no command at all (most tools never spawn anything) can never match. */
export function matchesInput(matcher: RuleConfig | undefined, command: Command | undefined): boolean {
  if (matcher == null) {
    return true;
  }
  if (command == null) {
    return false;
  }
  return ruleConfigMatches(command, matcher);
}
