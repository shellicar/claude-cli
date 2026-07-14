/** Which side of the conversation a message is. */
export type HistoryRole = 'user' | 'assistant';

/**
 * One content block of a message, in the raw Anthropic block vocabulary (`text`, `thinking`, `tool_use`,
 * `tool_result`, …). No renames — Claude already knows the API's shapes. `text` is the block's searchable text,
 * or `null` when the block carries none (a `tool_use` with nothing rendered, an encrypted `redacted_thinking`).
 */
export type HistoryBlock = {
  seq: number;
  type: string;
  text: string | null;
};

/**
 * One message, and everything the store persists for it. `id` is the message's own id and the sole dedup key:
 * writing the same `id` again is a no-op, never an update, because a message's content cannot change. `turnId`
 * links the user/assistant pair of one turn; `queryId` links every turn of one query. `conversationId` is the
 * session the message belongs to — the CLI's session id live, the audit file's name stem at ingest — and is the
 * `session` a citation resolves to. It is not generated and never a dedup key.
 */
export type HistoryMessage = {
  id: string;
  conversationId: string;
  turnId: string;
  queryId: string;
  timestamp: string;
  role: HistoryRole;
  blocks: HistoryBlock[];
};

/** A relevance query over the index. `query` is plain words; `role` and `type` optionally narrow; `limit` caps the hits. */
export type HistorySearchQuery = {
  query: string;
  role?: HistoryRole;
  type?: string;
  limit: number;
};

/**
 * A search hit: where the match is (the `conversationId` + `turnId` citation, opened with `read`), what it is
 * (`role`, `type`, `timestamp`), a snippet window around the match, and the relevance `score` (higher is a
 * better match). `conversationId` is the citation's `session`.
 */
export type HistorySearchHit = {
  conversationId: string;
  turnId: string;
  timestamp: string;
  role: HistoryRole;
  type: string;
  snippet: string;
  score: number;
};

/** A read request: the `turnId` citations to open, and how many turns of context to include either side of each. */
export type HistoryReadRequest = {
  citations: string[];
  window: number;
};

/** One event inside a read window: a single content block, carrying its message's `role`/`timestamp` and the block's `type` and (capped) `text`. */
export type HistoryEvent = {
  turnId: string;
  timestamp: string;
  role: HistoryRole;
  type: string;
  text: string;
};

/** The events around one citation, in chronological order. `conversationId` + `turnId` is the citation this window was centred on. */
export type HistoryWindow = {
  conversationId: string;
  turnId: string;
  events: HistoryEvent[];
};

/**
 * Per-`type` bm25 multipliers, applied at query time (not baked into the index) so ranking can be retuned
 * without a re-index. A type absent from the map ranks at weight 1.0.
 */
export type HistoryTypeWeights = Record<string, number>;

/**
 * Defaults per write-model §6: prose and thinking rank on par (1.0) — a thinking block is routinely the most
 * descriptive account of a piece of work, not noise. Machine output is down-ranked, though a strong match can
 * still surface.
 */
export const DEFAULT_HISTORY_TYPE_WEIGHTS: HistoryTypeWeights = {
  text: 1.0,
  thinking: 1.0,
  tool_use: 0.3,
  tool_result: 0.3,
};
