import { randomUUID } from 'node:crypto';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { Conversation } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';
import { SqliteSessionStore } from '../persistence/SqliteSessionStore.js';

export class ConversationSession {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(Conversation) private readonly conversation!: Conversation;
  @dependsOn(SqliteSessionStore) private readonly sessionStore!: SqliteSessionStore;
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
      return;
    }
    const raw = await this.fs.readFile(historyPath);
    const messages = raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
    this.conversation.setHistory(messages);
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
    const content = this.conversation.messages.map((msg) => JSON.stringify(msg)).join('\n');
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
