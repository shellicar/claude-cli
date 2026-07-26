import type { RuleConfig } from '../Exec/ruleConfig.js';

export type Verdict = 'allow' | 'ask' | 'deny';

/** A tool name, a list of names, or absent \u2014 absent (or `'*'`) matches any tool. Never a
 *  fixed enum: any name a registry actually has is valid here, V1 or V2, with no code change
 *  needed to cover a new one. */
export type ToolMatch = string | string[];

/** One line of the policy, same discipline as a firewall rule chain: whatever it names must
 *  ALL hold for it to match (`tool` AND `input` AND `path`, whichever are present), and the
 *  first rule in the list that matches governs completely \u2014 a matched rule silent on a given
 *  operation falls to its own `default`, never to a later, less specific rule.
 *
 *  `input` reuses `RuleConfig` (`Exec/ruleConfig.ts`) verbatim \u2014 not a second, hand-invented
 *  matcher \u2014 tested duck-typed against whatever the tool's own input happens to expose
 *  (`program`/`args`), never by the engine knowing a specific tool has those fields.
 *
 *  `path` is a location glob (`$PWD`, `$HOME`, `~/`, `/**`, `*`), tested against whatever a
 *  tool's schema has marked as a path field \u2014 the same `isPath`/`collectPaths` mechanism
 *  already in use, just freed from a fixed two-zone grid into an ordered rule list.
 *
 *  `operation` is an open string key throughout \u2014 V1's `read`/`write`/`delete`, V2's
 *  `fs.list`/`fs.read`/`fs.write`/`fs.delete`/`fs.exec`, or anything a future tool introduces,
 *  all coexist without the resolver hardcoding any of them. */
export type Rule = {
  tool?: ToolMatch;
  input?: RuleConfig;
  path?: string;
  /** The verdict for any operation this rule doesn't name explicitly in `operations`. */
  default?: Verdict;
  operations?: Record<string, Verdict>;
  /** Shown to the model when this rule governs — the reason a `deny`/`ask` isn't a silent or
   *  unexplained refusal, same purpose as `RuleConfig.message` today. Falls back to `input`'s
   *  own `message` (so migrating an existing `RuleConfig` entry carries its message for free)
   *  when this rule sets none of its own. `{program}` is replaced with the matched input's
   *  `program` value, same interpolation `ruleConfigMatches` already does. */
  message?: string;
};

export type Resolution = { verdict: Verdict; message?: string };

export type PolicySet = Rule[];
