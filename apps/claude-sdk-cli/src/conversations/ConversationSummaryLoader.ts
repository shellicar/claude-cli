import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { dependsOn } from '@shellicar/core-di';
import { IConversationListState } from '../model/ConversationListState.js';
import { auditPathFor } from './auditPath.js';
import { type AuditSummary, scanAuditSummary } from './scanAuditSummary.js';

/** The loader's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConversationSummaryLoader {
  public abstract load(ids: readonly string[]): void;
}

/**
 * Fills in each listed conversation's summary, one file per tick, newest first.
 *
 * The list paints from the session store before any of this runs, so a slow read never delays the view;
 * each summary lands through `setSummary`, whose change event ViewHost coalesces into one repaint per
 * tick. Newest first because that is where the selection starts and where the answer usually is.
 *
 * A summary is memoised against the audit file's size. An audit file only ever grows, so a changed size
 * is exactly "this conversation has moved on"; an unchanged one means a second visit costs no read at
 * all. A missing audit file (a conversation that never took a turn) memoises its empty summary too,
 * rather than being retried on every visit.
 */
export class ConversationSummaryLoader extends IConversationSummaryLoader {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(IConversationListState) private readonly listState!: IConversationListState;
  @dependsOn(ILogger) private readonly logger!: ILogger;
  readonly #cache = new Map<string, { size: number; summary: AuditSummary }>();
  /** The generation of the in-flight walk. A new `load` bumps it, so an older walk stops rather than
   *  spending reads on a list the operator has already moved off. */
  #generation = 0;

  public load(ids: readonly string[]): void {
    this.#generation += 1;
    void this.#walk(ids, this.#generation);
  }

  async #walk(ids: readonly string[], generation: number): Promise<void> {
    for (const id of ids) {
      if (generation !== this.#generation) {
        return;
      }
      try {
        const summary = await this.#summaryFor(id);
        this.listState.setSummary(id, summary);
      } catch (err) {
        // A summary is a display convenience over a file that may be missing, truncated, or written by
        // another tool. A failure leaves the row unfilled rather than taking down the view.
        this.logger.warn('failed to summarise conversation', { id, err });
      }
    }
  }

  async #summaryFor(id: string): Promise<AuditSummary> {
    const path = auditPathFor(this.fs, id);
    if (!(await this.fs.exists(path))) {
      return this.#memoise(id, 0, scanAuditSummary(Buffer.alloc(0)));
    }
    const { size } = await this.fs.stat(path);
    const cached = this.#cache.get(id);
    if (cached !== undefined && cached.size === size) {
      return cached.summary;
    }
    return this.#memoise(id, size, scanAuditSummary(await this.fs.readFileBytes(path)));
  }

  #memoise(id: string, size: number, summary: AuditSummary): AuditSummary {
    this.#cache.set(id, { size, summary });
    return summary;
  }
}
