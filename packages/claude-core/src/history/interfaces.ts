import type { HistoryMessage, HistoryReadRequest, HistorySearchHit, HistorySearchQuery, HistoryWindow } from './types';

/**
 * The write seam. Persists one message, idempotent on the message `id`: a repeat is dropped, never updated, so a
 * message and its blocks land at most once. The CLI (at turn commit) and the standalone ingest both write through
 * this. Synchronous — the store does no async work.
 */
export abstract class IHistoryWriter {
  public abstract insert(message: HistoryMessage): void;
}

/**
 * The read seam. `search` returns ranked, cited hits over the full-text index; `read` opens a window of events
 * around each citation. The tools (SearchHistory / ReadHistory) sit on this. Synchronous — the store does no async work.
 */
export abstract class IHistoryReader {
  public abstract search(query: HistorySearchQuery): HistorySearchHit[];
  public abstract read(request: HistoryReadRequest): HistoryWindow[];
}
