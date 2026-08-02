import { join, sep } from 'node:path';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { canonicalisePath } from '@shellicar/claude-core/fs/canonicalisePath';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { dependsOn } from '@shellicar/core-di';
import { IConversationSession } from '../model/ConversationSession.js';

const SCRATCHPAD_DIR = 'scratchpad';

/** The scratchpad's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IWorkspace {
  /** The scratchpad root for the live conversation, or null when there is no scratchpad. */
  public abstract root(): string | null;
  /** Whether a write to `path` lands inside the scratchpad. */
  public abstract contains(path: string): boolean;
  /** Create the root if it is missing. Idempotent, so a swept temp directory is restored. */
  public abstract ensure(): Promise<void>;
}

/**
 * A per-conversation scratchpad under the OS temp directory, for working files that are not
 * project content.
 *
 * The path is keyed by the conversation id and nothing else: the instruction naming it is persisted
 * into the conversation's history, and so are the tool calls that write there, so a path that moved
 * would orphan both. That rules out the working directory as a component, since a session can be
 * moved to a new one mid-conversation. The temp directory is the point: the OS sweeps it, so nothing
 * accumulates and there is no teardown to get wrong.
 *
 * The uid is in the shared component rather than the leaf, so two users on one host each get their
 * own base directory instead of racing for a single one that the first to arrive would own.
 */
export class Workspace extends IWorkspace {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  @dependsOn(IConversationSession) private readonly session!: IConversationSession;

  public root(): string | null {
    if (!this.configLoader.config.workspace.enabled) {
      return null;
    }
    const uid = this.fs.uid();
    // No uid means no per-user base directory, so there is nothing to keep one user's scratchpad
    // out of another's. The scratchpad is a convenience, so it is simply absent there.
    if (uid == null) {
      return null;
    }
    const id = this.session.id;
    if (id === '') {
      return null;
    }
    // Canonicalised because the paths it is compared against are: the temp directory is reached
    // through a symlink on macOS, and an unresolved root would never match a resolved path.
    return canonicalisePath(join(this.fs.tmpdir(), `claude-${uid}`, id, SCRATCHPAD_DIR), this.fs);
  }

  /**
   * Strict, and resolved. Strict because the root itself is infrastructure the session depends on,
   * so it is not deletable through the scratchpad's own approval. Resolved because the approval has
   * to be a statement about where the write lands: a symlink planted inside the scratchpad points
   * somewhere else, and comparing the string it was asked with would approve writing there.
   */
  public contains(path: string): boolean {
    const root = this.root();
    if (root == null) {
      return false;
    }
    return canonicalisePath(path, this.fs).startsWith(root + sep);
  }

  public async ensure(): Promise<void> {
    const root = this.root();
    if (root != null) {
      await this.fs.mkdir(root);
    }
  }
}
