import type { Clock } from '@js-joda/core';
import type { IHistoryReader } from '@shellicar/claude-core/history/interfaces';
import { parseTimeBound, resolveTimeBound, type TimeBoundEdge } from './timeBound.js';
import type { SearchHistoryInput, SearchHistoryOutput } from './types.js';

// The store types a block's `type` as the raw string it stored, but only the four searchable block types
// (text, thinking, tool_use, tool_result) ever reach the FTS index — historyBlocks maps every other block to
// null text, and a null-text block is never indexed. So a hit's or event's type is always one of the four; this
// narrows the store's `string` to the enum spec.md's output declares.
type EventType = SearchHistoryOutput[number]['type'];

// Turn a schema-validated `since`/`until` string into the ISO instant the store compares against, or `undefined`
// when the field is absent. The schema already rejected a malformed bound, so parseTimeBound never returns null
// here; the branch is how the nullable oracle is consumed, not a guard against input the schema lets through.
function resolveBound(value: string | undefined, edge: TimeBoundEdge, clock: Clock): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = parseTimeBound(value);
  return parsed === null ? undefined : resolveTimeBound(parsed, edge, clock);
}

/** Shared between V1's `SearchHistory` and V2's — the query building, time-bound resolution, and
 *  output shaping is real logic, not a bare store call, so it lives here once rather than being
 *  copied into each tool. */
export function performSearchHistory(reader: IHistoryReader, currentSessionId: () => string, clock: Clock, input: SearchHistoryInput): SearchHistoryOutput {
  const since = resolveBound(input.since, 'since', clock);
  const until = resolveBound(input.until, 'until', clock);
  const excludeConversationId = input.includeCurrentSession ? undefined : currentSessionId();
  const hits = reader.search({ query: input.query, role: input.role, type: input.type, since, until, excludeConversationId, limit: input.limit });
  return hits.map((hit) => ({ session: hit.conversationId, turnId: hit.turnId, timestamp: hit.timestamp, role: hit.role, type: hit.type as EventType, snippet: hit.snippet }));
}
