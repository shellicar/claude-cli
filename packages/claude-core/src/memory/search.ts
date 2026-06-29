/**
 * Convert plain search words into a safe FTS5 MATCH expression.
 *
 * Only Unicode letter/number runs survive; each becomes a double-quoted string
 * literal, and the literals are OR-joined. Operators in the input (-, *, OR,
 * AND, NEAR, quotes, parens) cannot survive as syntax. Returns null when no
 * usable token remains, so the caller returns an empty result rather than error.
 */
export function toFtsMatch(query: string): string | null {
  const tokens = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) {
    return null;
  }
  return tokens.map((token) => `"${token}"`).join(' OR ');
}
