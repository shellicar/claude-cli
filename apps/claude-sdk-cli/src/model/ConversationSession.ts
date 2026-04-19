import { randomUUID } from 'node:crypto';
import type { Conversation } from '@shellicar/claude-sdk';
import type { IFileSystem } from '@shellicar/claude-sdk-tools/fs';

export class ConversationSession {
  readonly #fs: IFileSystem;
  readonly #conversation: Conversation;
  #id = '';

  public constructor(fs: IFileSystem, conversation: Conversation) {
    this.#fs = fs;
    this.#conversation = conversation;
  }

  public get id(): string {
    return this.#id;
  }

  public async startFresh(): Promise<void> {
    this.#id = randomUUID();
    const markerPath = `${this.#fs.cwd()}/.claude/.sdk-conversation-id`;
    await this.#fs.writeFile(markerPath, this.#id);
  }

  public async load(): Promise<void> {
    const markerPath = `${this.#fs.cwd()}/.claude/.sdk-conversation-id`;
    const markerExists = await this.#fs.exists(markerPath);
    if (markerExists) {
      const savedId = await this.#fs.readFile(markerPath);
      this.#id = savedId.trim();
      const historyPath = `${this.#fs.homedir()}/.claude/conversations/${this.#id}.jsonl`;
      const historyExists = await this.#fs.exists(historyPath);
      if (historyExists) {
        const raw = await this.#fs.readFile(historyPath);
        const messages = raw
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line));
        this.#conversation.setHistory(messages);
      }
    } else {
      this.#id = randomUUID();
      await this.#fs.writeFile(markerPath, this.#id);
    }
  }

  public async save(): Promise<void> {
    const historyPath = `${this.#fs.homedir()}/.claude/conversations/${this.#id}.jsonl`;
    const content = this.#conversation.messages.map((msg) => JSON.stringify(msg)).join('\n');
    await this.#fs.writeFile(historyPath, content);
  }

  public async createNew(): Promise<void> {
    await this.save();
    this.#id = randomUUID();
    const markerPath = `${this.#fs.cwd()}/.claude/.sdk-conversation-id`;
    await this.#fs.writeFile(markerPath, this.#id);
    this.#conversation.setHistory([]);
  }
}
