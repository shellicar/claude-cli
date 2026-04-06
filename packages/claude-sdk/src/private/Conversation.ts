import type { Anthropic } from '@anthropic-ai/sdk';

export type HistoryItem = {
  id?: string;
  msg: Anthropic.Beta.Messages.BetaMessageParam;
};

export function hasCompactionBlock(msg: Anthropic.Beta.Messages.BetaMessageParam): boolean {
  return Array.isArray(msg.content) && msg.content.some((b) => b.type === 'compaction');
}

export function trimToLastCompaction(items: HistoryItem[]): HistoryItem[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item && hasCompactionBlock(item.msg)) {
      return items.slice(i);
    }
  }
  return items;
}

/**
 * Pure in-memory conversation state.
 *
 * Knows nothing about files or I/O. Enforces role-alternation merge and
 * compaction-triggered clear. ConversationStore wraps this to add persistence.
 */
export class Conversation {
  readonly #items: HistoryItem[] = [];

  public get messages(): Anthropic.Beta.Messages.BetaMessageParam[] {
    return this.#items.map((item) => item.msg);
  }

  /**
   * Populate from pre-parsed items without applying merge or compaction logic.
   * Only ConversationStore should call this, during construction from a persisted file.
   */
  public load(items: HistoryItem[]): void {
    this.#items.push(...items);
  }

  /**
   * Append a message, enforcing role-alternation and compaction-clear semantics.
   * @param msg  The message to append.
   * @param opts Optional. `id` tags the message for later removal via `remove(id)`.
   */
  public push(msg: Anthropic.Beta.Messages.BetaMessageParam, opts?: { id?: string }): void {
    if (hasCompactionBlock(msg)) {
      this.#items.length = 0;
    }
    const last = this.#items.at(-1);
    if (last?.msg.role === 'user' && msg.role === 'user') {
      // Merge consecutive user messages — the API requires strict role alternation.
      // On merge the tag is dropped (the merged message is no longer a single addressable unit).
      const lastContent = Array.isArray(last.msg.content) ? last.msg.content : [{ type: 'text' as const, text: last.msg.content as string }];
      const newContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text' as const, text: msg.content as string }];
      last.msg = { ...last.msg, content: [...lastContent, ...newContent] };
      last.id = undefined;
    } else {
      this.#items.push({ id: opts?.id, msg });
    }
  }

  /**
   * Remove the last message tagged with `id`.
   * Returns `true` if found and removed, `false` if no message with that id exists.
   */
  public remove(id: string): boolean {
    const idx = this.#items.findLastIndex((item) => item.id === id);
    if (idx < 0) {
      return false;
    }
    this.#items.splice(idx, 1);
    return true;
  }
}
