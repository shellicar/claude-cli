/** The result of reading the owned identity file live from disk. */
export type IdentityRead =
  | { state: 'none' } // the conversation owns no identity
  | { state: 'missing'; path: string } // owns a path, but the file is absent right now
  | { state: 'present'; path: string; body: string; name: string | null }; // read live; name is null when frontmatter has none

/**
 * The conversation's system identity: the file PATH it owns (persisted, keyed by
 * conversation id) plus the live read of that file. Injectable contract per the
 * CLAUDE.md DI rule; `SystemIdentity` is the concrete.
 */
export abstract class ISystemIdentity {
  /** The path this conversation currently owns, or null. Display/inherit use it; the model never sees the path. */
  public abstract get path(): string | null;
  /** Assert (set + persist) the identity for a conversation. Unconditional: setting always writes. */
  public abstract assert(conversationId: string, path: string): void;
  /** Load the path the conversation already owns (flag-absent resume/load). No write. */
  public abstract load(conversationId: string): void;
  /** Ctrl-/ n: a new conversation inherits the running identity and persists it against the new id. */
  public abstract inherit(newConversationId: string): void;
  /** Read the owned file live. Absent file degrades to `missing`; no cache, no fallback body. */
  public abstract read(): Promise<IdentityRead>;
}
