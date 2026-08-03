import { join, sep } from 'node:path';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { canonicalisePath } from '@shellicar/claude-core/fs/canonicalisePath';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { dependsOn } from '@shellicar/core-di';
import type { CliConfigLoader } from '../cli-config/CliConfigLoader.js';
import { IConversationSession } from '../model/ConversationSession.js';

const SCRATCHPAD_DIR = 'scratchpad';
// rwx for the owner, nothing for anyone else.
const OWNER_ONLY = 0o700;
// The bits that make a directory unsafe: any access at all beyond its owner. tmux guards its socket
// directory with the `other` triad alone, which is right where each user has a group to themselves.
// macOS gives every local account the same primary group (staff), so group access there is public
// access, and the scratchpad carries blanket write approval for everything beneath it.
const UNSAFE_BITS = 0o077;

const REMINDER_BODY = [
  'Use it for anything that is working material rather than project content: intermediate results,',
  'a throwaway script, a note held across several steps, output that does not belong in the repository.',
  'Prefer it over the system temp directory, and over writing scratch files into the project.',
  'Reads, writes and deletes inside it need no approval. It is removed when the operating system',
  'sweeps its temp directory, so nothing there is durable and nothing needs cleaning up.',
].join('\n');

/**
 * The standing reminder naming the scratchpad. Carried as durable config rather than written into
 * history, so it survives a compaction the way CLAUDE.md does and vanishes when the scratchpad does.
 */
export function scratchpadReminder(root: string): string {
  return `A scratchpad directory is available for temporary files:\n\n${root}\n\n${REMINDER_BODY}`;
}

/**
 * Why the scratchpad cannot be used, and what the operator can do about it. The remedy travels with
 * the reason because they are not interchangeable: a directory belonging to somebody else is not one
 * you can go and delete.
 */
export type Refusal = { reason: string; remedy: string };

/**
 * The two lines shown when the scratchpad cannot be used. The first is what is wrong, naming the
 * directory to act on; the second is what it costs, since nothing else about the session changes and
 * the loss would otherwise be invisible.
 */
export function scratchpadUnavailableNotice(refusal: Refusal): string {
  return `\u26a0\ufe0f scratchpad unavailable: ${refusal.reason}\nClaude will ask before writing temporary files. ${refusal.remedy}`;
}

/** The scratchpad's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IWorkspace {
  /** The verified scratchpad root, or null when there is no usable scratchpad. Never a path that
   *  has not been created and checked, since that path is what the approval trusts. */
  public abstract root(): string | null;
  /** Whether a write to `path` lands inside the scratchpad. */
  public abstract contains(path: string): boolean;
  /** Create and verify the scratchpad. Idempotent, and never throws: a scratchpad that cannot be
   *  made safe is absent, not fatal. Returns why it is absent, or null when it is ready. */
  public abstract resolve(): Promise<Refusal | null>;
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
  @dependsOn(ConfigLoader) private readonly configLoader!: CliConfigLoader;
  @dependsOn(IConversationSession) private readonly session!: IConversationSession;
  @dependsOn(ILogger) private readonly logger!: ILogger;

  #verified: string | null = null;
  #verifiedFor: string | null = null;

  public root(): string | null {
    // Config is read here as well as in resolve, so switching the feature off takes effect on the
    // next tool call rather than at the next conversation. It is the only lever over an approval
    // that bypasses the permission matrix, so it should not need a restart to pull.
    if (!this.configLoader.config.workspace.enabled) {
      return null;
    }
    return this.#verifiedFor === this.#conversationKey() ? this.#verified : null;
  }

  /**
   * Run when the conversation changes, not per turn: the scratchpad belongs to the conversation, and
   * re-checking every turn would not close the window it appears to close anyway.
   *
   * The window it leaves open: if the base is removed mid-conversation, the next approved write
   * recreates it through the ordinary parent-directory creation, at the ambient umask and unchecked.
   * Accepted because anything that removes it has already taken the scratchpad's contents with it,
   * so the conversation's references to those files are dead either way, and the next conversation
   * or CLI restart re-checks from scratch.
   */
  public async resolve(): Promise<Refusal | null> {
    this.#verified = null;
    this.#verifiedFor = this.#conversationKey();

    if (!this.configLoader.config.workspace.enabled) {
      return null;
    }
    const uid = this.fs.uid();
    // No uid means no per-user base directory, so nothing separates one user's scratchpad from
    // another's. Silent rather than refused: it is a fact about the platform that no action can
    // change, and announcing it every launch would be permanent noise.
    if (uid == null) {
      this.logger.info('workspace unsupported on this platform');
      return null;
    }
    const id = this.session.id;
    if (id === '') {
      return null;
    }

    const base = join(this.fs.tmpdir(), `claude-${uid}`);
    try {
      await this.fs.mkdir(base, OWNER_ONLY);
      const refusal = await this.#unsafe(base, uid);
      if (refusal != null) {
        this.logger.warn('workspace refused', { base, reason: refusal.reason });
        return refusal;
      }
      const root = canonicalisePath(join(base, id, SCRATCHPAD_DIR), this.fs);
      await this.fs.mkdir(root, OWNER_ONLY);
      this.#verified = root;
      return null;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn('workspace unavailable', { base, reason });
      return { reason, remedy: `Check ${base}.` };
    }
  }

  /**
   * The one check that matters, on the one directory that matters. Everything below the base is safe
   * once the base is ours and owner-only, because no other user can create or remove an entry inside
   * it. lstat rather than stat, so a base replaced by a symlink fails the directory test instead of
   * being followed to whatever it points at.
   */
  async #unsafe(base: string, uid: number): Promise<Refusal | null> {
    const stat = await this.fs.lstat(base);
    if (!stat.isDirectory()) {
      return { reason: `${base} is not a directory`, remedy: `Remove ${base} to restore it.` };
    }
    if (stat.uid !== uid) {
      // Deliberately not "remove it": it is not yours to remove, and telling someone to delete
      // another user's directory is advice they cannot take and should not try.
      return { reason: `${base} is owned by another user`, remedy: 'Nothing on your side can change that; the scratchpad stays off.' };
    }
    if ((stat.mode & UNSAFE_BITS) !== 0) {
      return { reason: `${base} is reachable by other users`, remedy: `Run chmod 700 ${base} to restore it.` };
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
