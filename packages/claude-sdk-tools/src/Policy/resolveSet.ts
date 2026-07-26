import type { Verdict } from './types.js';

const SEVERITY: Record<Verdict, number> = { allow: 0, ask: 1, deny: 2 };

/** Multiple independently-resolved verdicts fold to the strictest \u2014 the same principle a
 *  `DeleteFile` with several paths, or an Orchestrate stage's resolved batch, already needs:
 *  one target outside the safe zone must not be hidden behind the rest being fine. An empty
 *  set is `Ask`, not `Allow` \u2014 no targets resolved is not evidence of safety. */
export function resolveSet(verdicts: Verdict[]): Verdict {
  if (verdicts.length === 0) {
    return 'ask';
  }
  return verdicts.reduce((strictest, v) => (SEVERITY[v] > SEVERITY[strictest] ? v : strictest));
}
