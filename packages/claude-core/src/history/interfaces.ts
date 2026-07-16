import type { HistoryMessage, HistoryReadRequest, HistorySearchHit, HistorySearchQuery, HistorySweepResult, HistoryWindow } from './types';

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

/**
 * The sweep seam. `sweep` runs one maintenance pass over the index: it takes the lease, deduplicates the messages
 * added since the watermark against the existing corpus, and advances the watermark. A pass that cannot take the
 * lease (another CLI holds it) does nothing and reports `ran: false`. Synchronous — the store does no async work;
 * the jittered timing that drives repeated passes lives in the scheduler, not here.
 */
export abstract class IHistorySweeper {
  public abstract sweep(): HistorySweepResult;
}
