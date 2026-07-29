import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { dependsOn } from '@shellicar/core-di';
import { IConversationListState } from '../model/ConversationListState.js';
import { auditPathFor } from './auditPath.js';
import { PEEK_LINES, scanAuditPeek } from './scanAuditPeek.js';

/** The loader's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConversationPeekLoader {
  public abstract load(id: string): void;
}

/**
 * Reads a conversation's tail when its peek opens.
 *
 * Kept apart from the summary loader because the two have opposite cost rules. A summary is read for
 * every row the moment the view opens, so it must be cheap; a peek is read only for the one
 * conversation the operator chose to open, so it may take as long as that conversation is large. The
 * state ignores content that lands after the operator has moved on, so a slow read is harmless rather
 * than something to cancel.
 */
export class ConversationPeekLoader extends IConversationPeekLoader {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(IConversationListState) private readonly listState!: IConversationListState;
  @dependsOn(ILogger) private readonly logger!: ILogger;

  public load(id: string): void {
    void this.#read(id);
  }

  async #read(id: string): Promise<void> {
    try {
      const path = auditPathFor(this.fs, id);
      const bytes = (await this.fs.exists(path)) ? await this.fs.readFileBytes(path) : Buffer.alloc(0);
      this.listState.setPeek(id, scanAuditPeek(bytes, PEEK_LINES));
    } catch (err) {
      this.logger.warn('failed to read conversation peek', { id, err });
    }
  }
}
