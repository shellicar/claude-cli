import { randomUUID } from 'node:crypto';
import type { Anthropic } from '@anthropic-ai/sdk';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { HEAL_REASON_ABANDONED, IConversation, type MessageIdentity } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { ISqliteSessionStore } from '../persistence/SqliteSessionStore.js';

/** The session's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConversationSession {
  public abstract get id(): string;
  public abstract get turnCount(): number;
  public abstract conversationTip(): { messageId: string; queryId: string; turnId: string } | undefined;
  public abstract startFresh(): Promise<void>;
  public abstract resume(id: string): Promise<void>;
  public abstract load(): Promise<void>;
  public abstract saveSession(): Promise<void>;
  public abstract saveConversation(): Promise<void>;
  public abstract createNew(): Promise<void>;
}

export class ConversationSession extends IConversationSession {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(IConversation) private readonly conversation!: IConversation;
  @dependsOn(ISqliteSessionStore) private readonly sessionStore!: ISqliteSessionStore;
  #id = '';

  public get id(): string {
    return this.#id;
  }

  public get turnCount(): number {
    return this.conversation.messages.filter((m) => m.role === 'assistant').length;
  }

  /** The round's ids, read off the tip (the last message) — the locked "served off the in-memory array".
   *  The change/telemetry publishers and the approval bridge read the current query/turn from here.
   *  `undefined` when the tip carries no identity (an empty or legacy conversation). */
  public conversationTip(): { messageId: string; queryId: string; turnId: string } | undefined {
    const id = this.conversation.items.at(-1)?.identity;
    return id == null ? undefined : { messageId: id.messageId, queryId: id.queryId, turnId: id.turnId };
  }

  public async startFresh(): Promise<void> {
    this.#id = randomUUID();
  }

  async #loadHistoryForId(id: string): Promise<void> {
    const historyPath = `${this.fs.homedir()}/.claude/conversations/${id}.jsonl`;
    const historyExists = await this.fs.exists(historyPath);
    if (!historyExists) {
      // An id with no stored history is an empty conversation, not "leave what is loaded". The
      // distinction only bites once a conversation can be adopted mid-process: whatever was in
      // memory would become this conversation's history and be written back out under its id.
      this.conversation.setHistory([]);
      return;
    }
    const raw = await this.fs.readFile(historyPath);
    const rows = raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        // The persisted row is the BetaMessageParam with an additive `_identity` sidecar (underscored so
        // it never collides with an API key). Split it back out so the identity is restored but never
        // reaches the API request slice. A legacy row without it loads with identity undefined.
        const { _identity, ...msg } = JSON.parse(line) as Anthropic.Beta.Messages.BetaMessageParam & { _identity?: MessageIdentity };
        return { msg, identity: _identity };
      });
    this.conversation.setHistory(rows);
    // A prior process may have died between committing a tool_use and its tool_result (crash,
    // signal, hung tool), leaving the record on a dangling tool_use the API refuses to continue.
    // Self-heal on load with an honest synthetic result: at this site the cause really is known
    // (the process just restarted onto this file), unlike TurnRunner's pre-request net, which
    // catches whatever load couldn't see and can't claim a cause.
    this.conversation.healDanglingToolUse(HEAL_REASON_ABANDONED);
  }

  public async resume(id: string): Promise<void> {
    this.#id = id;
    await this.#loadHistoryForId(id);
  }

  public async load(): Promise<void> {
    const savedId = this.sessionStore.mostRecentByCwd(this.fs.cwd());
    if (savedId !== undefined) {
      this.#id = savedId;
      await this.#loadHistoryForId(this.#id);
    } else {
      this.#id = randomUUID();
    }
  }

  public async saveSession(): Promise<void> {
    this.sessionStore.append(this.#id, this.fs.cwd(), new Date().toISOString());
  }

  public async saveConversation(): Promise<void> {
    const historyPath = `${this.fs.homedir()}/.claude/conversations/${this.#id}.jsonl`;
    const tempPath = `${historyPath}.${randomUUID()}.tmp`;
    // Write the identity beside the message as an additive `_identity` field so the three ids survive the
    // round-trip. cloneForRequest reads `msg` only, so `_identity` never reaches the API.
    const content = this.conversation.items.map((item) => JSON.stringify(item.identity ? { ...item.msg, _identity: item.identity } : item.msg)).join('\n');
    // Per-turn writes make a partial-write window costly. Write a sibling temp
    // file then rename — rename is atomic on the same filesystem, so a reader
    // sees either the old file or the complete new one, never a half-written one.
    await this.fs.writeFile(tempPath, content);
    await this.fs.rename(tempPath, historyPath);
  }

  public async createNew(): Promise<void> {
    this.#id = randomUUID();
    this.conversation.setHistory([]);
  }
}
