import type { Conversation } from '@shellicar/claude-sdk';
import type { IFileSystem } from '@shellicar/claude-sdk-tools/fs';

export class ConversationSession {
  readonly #fs: IFileSystem;
  readonly #conversation: Conversation;
  #id: string = '';

  constructor(fs: IFileSystem, conversation: Conversation) {
    this.#fs = fs;
    this.#conversation = conversation;
  }

  get id(): string {
    return this.#id;
  }

  async load(): Promise<void> {}
  async save(): Promise<void> {}
  async createNew(): Promise<void> {}
}
