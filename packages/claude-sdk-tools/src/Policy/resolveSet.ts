import type { Resolution, Verdict } from './types.js';

const SEVERITY: Record<Verdict, number> = { allow: 0, ask: 1, deny: 2 };

/** Multiple independently-resolved verdicts fold to the strictest \u2014 the same principle a
 *  `DeleteFile` with several paths, or an Orchestrate stage's resolved batch, already needs:
 *  one target outside the safe zone must not be hidden behind the rest being fine. An empty
 *  set is `Ask`, not `Allow` \u2014 no targets resolved is not evidence of safety. Carries the
 *  message belonging to whichever resolution was actually the strictest, not an arbitrary one. */
export function resolveSet(resolutions: Resolution[]): Resolution {
  if (resolutions.length === 0) {
    return { verdict: 'ask' };
  }
  return resolutions.reduce((strictest, r) => (SEVERITY[r.verdict] > SEVERITY[strictest.verdict] ? r : strictest));
}
