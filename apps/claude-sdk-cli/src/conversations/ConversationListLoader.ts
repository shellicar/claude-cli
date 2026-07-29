import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { dependsOn } from '@shellicar/core-di';
import { IConversationListState } from '../model/ConversationListState.js';
import { ISqliteSessionStore } from '../persistence/SqliteSessionStore.js';
import { IConversationSummaryLoader } from './ConversationSummaryLoader.js';

/** The loader's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConversationListLoader {
  public abstract refresh(): void;
}

/**
 * Rebuilds the conversation list for the current directory and starts the summary reads.
 *
 * The two halves are deliberately split in time. Listing the ids is a synchronous store read, so the
 * view can paint every row the instant F3 is pressed; the figures arrive afterwards, one file at a
 * time. That ordering is the whole reason the view never blocks on a large conversation.
 */
export class ConversationListLoader extends IConversationListLoader {
  @dependsOn(ISqliteSessionStore) private readonly sessionStore!: ISqliteSessionStore;
  @dependsOn(IConversationListState) private readonly listState!: IConversationListState;
  @dependsOn(IConversationSummaryLoader) private readonly summaryLoader!: IConversationSummaryLoader;
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;

  public refresh(): void {
    const ids = this.sessionStore.listByCwd(this.fs.cwd());
    this.listState.setEntries(ids);
    this.summaryLoader.load(ids);
  }
}
