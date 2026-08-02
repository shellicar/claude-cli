import { join } from 'node:path';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { dependsOn } from '@shellicar/core-di';
import { IConversationSession } from '../model/ConversationSession.js';

const WORKSPACE_DIR = 'claude-sdk-cli';
const SCRATCHPAD_DIR = 'scratchpad';

/** The scratchpad's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IWorkspace {
  /** The scratchpad root for the live conversation, or null when the feature is disabled. */
  public abstract root(): string | null;
  /** Create the root if it is missing. Idempotent, so a swept temp directory is restored. */
  public abstract ensure(): Promise<void>;
}

function slug(path: string): string {
  return path.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * A per-conversation scratchpad under the OS temp directory, for working files that are not
 * project content.
 *
 * The path is keyed by conversation id, never by process or turn: the instruction naming it is
 * persisted into the conversation's history, and so are the tool calls that write there, so a
 * path that moved would orphan both on resume. The temp directory is the point: the OS sweeps it,
 * so nothing accumulates and there is no teardown to get wrong.
 */
export class Workspace extends IWorkspace {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  @dependsOn(IConversationSession) private readonly session!: IConversationSession;

  public root(): string | null {
    if (!this.configLoader.config.workspace.enabled) {
      return null;
    }
    const id = this.session.id;
    if (id === '') {
      return null;
    }
    return join(this.fs.tmpdir(), WORKSPACE_DIR, slug(this.fs.cwd()), id, SCRATCHPAD_DIR);
  }

  public async ensure(): Promise<void> {
    const root = this.root();
    if (root != null) {
      await this.fs.mkdir(root);
    }
  }
}
