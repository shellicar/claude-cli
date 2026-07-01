/** Self-labelling key/value bag stamped by the CLI at write time and returned on every result, so a cross-context hit announces where it came from. The tool hardcodes no keys. */
export type MemoryEnvironment = Record<string, string>;

/** What the author writes for the next Claude. `type` classifies (cheap — the author knows what they wrote); `keywords` are extra search terms that need not appear in the prose. */
export type MemoryDraft = {
  title: string;
  body: string;
  type: string;
  keywords: string[];
};

/** A stored memory: the authored fields, the environment it was written in, and the store-assigned id + timestamp. `createdAt` is an ISO-8601 string on the contract. */
export type MemoryEntry = {
  id: string;
  title: string;
  body: string;
  type: string;
  keywords: string[];
  environment: MemoryEnvironment;
  createdAt: string;
};

/** A search hit: a stored entry plus its relevance `score` (higher is a better match). */
export type MemorySearchHit = MemoryEntry & { score: number };

/** A relevance query. `query` is plain words; `type` optionally narrows; `limit` caps the result count. */
export type MemorySearchQuery = {
  query: string;
  type?: string;
  limit: number;
};

/** One row of the "count by type" summary. */
export type MemoryTypeCount = {
  type: string;
  count: number;
};
