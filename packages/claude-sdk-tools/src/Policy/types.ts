import type { InputMatcher } from './matchInput.js';

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
 *  `input` names the tool's own real fields verbatim (`program`, `args`, whatever the tool
 *  actually calls them) \u2014 structural matching against the real input, never a translated or
 *  invented vocabulary, so the engine needs no per-tool knowledge to apply it.
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
  input?: InputMatcher;
  path?: string;
  /** The verdict for any operation this rule doesn't name explicitly in `operations`. */
  default?: Verdict;
  operations?: Record<string, Verdict>;
  /** Shown to the model when this rule governs \u2014 the reason a `deny`/`ask` isn't a silent or
   *  unexplained refusal. `{key}` is replaced with `input[key]` for whichever field of the
   *  real input actually exists, generic the same way `input` matching itself is. */
  message?: string;
};

export type Resolution = { verdict: Verdict; message?: string };

export type PolicySet = Rule[];
