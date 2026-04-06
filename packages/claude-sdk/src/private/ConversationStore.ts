import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Anthropic } from '@anthropic-ai/sdk';
import { Conversation, trimToLastCompaction } from './Conversation';

/**
 * File-backed conversation store.
 *
 * Wraps Conversation (pure data) and persists to a JSONL file after every
 * mutation. When no historyFile is provided it behaves as an in-memory store
 * identical to bare Conversation.
 */
export class ConversationStore {
  readonly #conversation: Conversation;
  readonly #historyFile: string | undefined;

  public constructor(historyFile?: string) {
    this.#historyFile = historyFile;
    this.#conversation = new Conversation();
    if (historyFile) {
      try {
        const raw = readFileSync(historyFile, 'utf-8');
        const msgs = raw
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as Anthropic.Beta.Messages.BetaMessageParam);
        this.#conversation.load(trimToLastCompaction(msgs.map((msg) => ({ msg }))));
      } catch {
        // No history file yet — start fresh.
      }
    }
  }

  public get messages(): Anthropic.Beta.Messages.BetaMessageParam[] {
    return this.#conversation.messages;
  }

  public push(msg: Anthropic.Beta.Messages.BetaMessageParam, opts?: { id?: string }): void {
    this.#conversation.push(msg, opts);
    this.#save();
  }

  public remove(id: string): boolean {
    const result = this.#conversation.remove(id);
    this.#save();
    return result;
  }

  #save(): void {
    if (!this.#historyFile) {
      return;
    }
    const tmp = `${this.#historyFile}.tmp`;
    writeFileSync(tmp, this.#conversation.messages.map((msg) => JSON.stringify(msg)).join('\n'));
    renameSync(tmp, this.#historyFile);
  }
}
