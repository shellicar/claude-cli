import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IConversation } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { IWorkspace } from '../workspace/Workspace.js';

const WORKSPACE_HEADER = 'A scratchpad directory is available for temporary files:';

const WORKSPACE_BODY = [
  'Use it for anything that is working material rather than project content: intermediate results,',
  'a throwaway script, a note held across several steps, output that does not belong in the repository.',
  'Prefer it over the system temp directory, and over writing scratch files into the project.',
  'Reads, writes and deletes inside it need no approval. It is removed when the operating system',
  'sweeps its temp directory, so nothing there is durable and nothing needs cleaning up.',
].join('\n');

/**
 * Emits the persisted `<system-reminder>` naming the scratchpad, once, on the conversation's
 * opening message.
 *
 * Written once rather than each turn because it lands after the CLAUDE.md cache marker: the
 * conversation's cached prefix stays intact, and re-stating it every turn would buy nothing.
 * The same condition the SDK uses for CLAUDE.md decides it, so a resumed conversation stays
 * silent and keeps the announcement it already has in history.
 */
export class WorkspaceTracker {
  @dependsOn(IWorkspace) private readonly workspace!: IWorkspace;
  @dependsOn(IConversation) private readonly conversation!: IConversation;
  @dependsOn(ILogger) private readonly logger!: ILogger;

  /** The reminder text for this query, or null when there is nothing to announce. */
  public scan(): string | null {
    const root = this.workspace.root();
    if (root == null) {
      return null;
    }
    if (this.conversation.messages.some((m) => m.role === 'user')) {
      return null;
    }
    this.logger.info('workspace announced', { root });
    return `${WORKSPACE_HEADER}\n\n${root}\n\n${WORKSPACE_BODY}`;
  }
}
