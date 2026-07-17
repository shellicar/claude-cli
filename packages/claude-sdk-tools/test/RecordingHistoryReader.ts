import type { IHistoryReader } from '@shellicar/claude-core/history/interfaces';
import type { HistoryReadRequest, HistorySearchHit, HistorySearchQuery, HistoryWindow } from '@shellicar/claude-core/history/types';

/**
 * A spy over the read seam: it records the last query/request the tool passed down and returns a canned result the
 * test sets. Lets a tool test assert both what the tool forwarded (mapping) and how it shaped what came back.
 */
export class RecordingHistoryReader implements IHistoryReader {
  public searchArg: HistorySearchQuery | undefined;
  public searchResult: HistorySearchHit[] = [];
  public readArg: HistoryReadRequest | undefined;
  public readResult: HistoryWindow[] = [];

  public search(query: HistorySearchQuery): HistorySearchHit[] {
    this.searchArg = query;
    return this.searchResult;
  }

  public read(request: HistoryReadRequest): HistoryWindow[] {
    this.readArg = request;
    return this.readResult;
  }
}
