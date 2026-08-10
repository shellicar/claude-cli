import { randomUUID } from 'node:crypto';
import type { Anthropic } from '@anthropic-ai/sdk';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { HEAL_REASON_ABANDONED, IConversation } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { ISqliteSessionStore } from '../persistence/SqliteSessionStore.js';

/** The session's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConversationSession {
  public abstract get id(): string;
  public abstract get turnCount(): number;
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
        // A file written before the ids moved out carries an additive `_identity` sidecar. Strip it:
        // nothing reads it any more, and `cloneForRequest` would otherwise hand it to the API.
        const { _identity, ...msg } = JSON.parse(line) as Anthropic.Beta.Messages.BetaMessageParam & { _identity?: unknown };
        return { msg };
      });
    this.conversation.setHistory(rows);
    // A prior process may have died between committing a tool_use and its tool_result (crash,
    // signal, hung tool), leaving the record on a dangling tool_use the API refuses to continue.
    // Self-heal on load with an honest synthetic result: at this site the cause really is known
    // (the process just restarted onto this file), unlike TurnRunner's pre-request net, which
    // catches whatever load couldn't see and can't claim a cause.
    this.conversation.healDanglingToolUse(HEAL_REASON_ABANDONED);
  }

  /** Loads first and adopts the id only once the history is in memory. The order matters: between the
   *  two the process would otherwise claim to be the new conversation while still holding the old
   *  one's messages, and anything saving in that window would write them out under the new id. */
  public async resume(id: string): Promise<void> {
    await this.#loadHistoryForId(id);
    this.#id = id;
  }

  public async load(): Promise<void> {
    const savedId = this.sessionStore.mostRecentByCwd(this.fs.cwd());
    if (savedId !== undefined) {
      await this.#loadHistoryForId(savedId);
      this.#id = savedId;
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
    // Messages only. The ids belong to the audit file, which is the durable per-message record.
    const content = this.conversation.items.map((item) => JSON.stringify(item.msg)).join('\n');
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
