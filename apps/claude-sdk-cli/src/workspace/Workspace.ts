import { join, sep } from 'node:path';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { canonicalisePath } from '@shellicar/claude-core/fs/canonicalisePath';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { dependsOn } from '@shellicar/core-di';
import { IConversationSession } from '../model/ConversationSession.js';

const SCRATCHPAD_DIR = 'scratchpad';
// rwx for the owner, nothing for anyone else.
const OWNER_ONLY = 0o700;

/** The scratchpad's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IWorkspace {
  /** The verified scratchpad root, or null when there is no usable scratchpad. Never a path that
   *  has not been created and checked, since that path is what the approval trusts. */
  public abstract root(): string | null;
  /** Whether a write to `path` lands inside the scratchpad. */
  public abstract contains(path: string): boolean;
  /** Create and verify the scratchpad. Idempotent, and never throws: a scratchpad that cannot be
   *  made safe is absent, not fatal. Returns the reason it is absent, or null when it is ready. */
  public abstract resolve(): Promise<string | null>;
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
  @dependsOn(ILogger) private readonly logger!: ILogger;

  #verified: string | null = null;
  #verifiedFor: string | null = null;

  public root(): string | null {
    return this.#verifiedFor === this.#conversationKey() ? this.#verified : null;
  }

  /**
   * Re-run per turn rather than once per conversation. The scratchpad lives in a directory the OS
   * sweeps, and a swept base would otherwise be recreated by the first write at whatever the umask
   * gives, with nothing checking who owns it. Re-verifying is what keeps the guarantee true rather
   * than merely true once.
   */
  public async resolve(): Promise<string | null> {
    this.#verified = null;
    this.#verifiedFor = this.#conversationKey();

    if (!this.configLoader.config.workspace.enabled) {
      return null;
    }
    const uid = this.fs.uid();
    // No uid means no per-user base directory, so nothing separates one user's scratchpad from
    // another's. The scratchpad is a convenience, so it is simply absent there.
    if (uid == null) {
      return 'this platform has no user id to separate one user\u2019s scratchpad from another\u2019s';
    }
    const id = this.session.id;
    if (id === '') {
      return null;
    }

    const base = join(this.fs.tmpdir(), `claude-${uid}`);
    try {
      await this.fs.mkdir(base, OWNER_ONLY);
      const reason = await this.#unsafe(base, uid);
      if (reason != null) {
        this.logger.warn('workspace refused', { base, reason });
        return reason;
      }
      const root = canonicalisePath(join(base, id, SCRATCHPAD_DIR), this.fs);
      await this.fs.mkdir(root, OWNER_ONLY);
      this.#verified = root;
      return null;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn('workspace unavailable', { base, reason });
      return reason;
    }
  }

  /**
   * The one check that matters, on the one directory that matters. Everything below the base is
   * safe once the base is ours and owner-only, because no other user can create or remove an entry
   * inside it. lstat rather than stat, so a base replaced by a symlink fails the directory test
   * instead of being followed to whatever it points at.
   */
  async #unsafe(base: string, uid: number): Promise<string | null> {
    const stat = await this.fs.lstat(base);
    if (!stat.isDirectory()) {
      return `${base} is not a directory`;
    }
    if (stat.uid !== uid) {
      return `${base} is owned by another user`;
    }
    if ((stat.mode & ~OWNER_ONLY) !== 0) {
      return `${base} is accessible to other users`;
    }
    return null;
  }

  #conversationKey(): string {
    return this.session.id;
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
    try {
      return canonicalisePath(path, this.fs).startsWith(root + sep);
    } catch {
      // A path that cannot be canonicalised is one this cannot make a statement about, and the
      // statement it would otherwise make is "approve without asking".
      return false;
    }
  }
}
