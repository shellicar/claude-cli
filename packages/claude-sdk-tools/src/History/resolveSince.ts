// Milliseconds in each relative-span unit. 'd' and 'w' are the common cases; 's'/'m'/'h' round it out.
const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Turn a relative span like '7d' or '2w' into the ISO cutoff before which hits are dropped, measured back from
 * `now`. An unrecognised span yields `undefined` — no lower bound, never an error — so a search with a garbled
 * `since` still returns results rather than failing.
 */
export function resolveSince(span: string, now: Date): string | undefined {
  const match = /^(\d+)([smhdw])$/.exec(span.trim());
  if (match === null) {
    return undefined;
  }
  const amount = Number(match[1]);
  const unitMs = UNIT_MS[match[2]];
  return new Date(now.getTime() - amount * unitMs).toISOString();
}
