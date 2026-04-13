import type { Anthropic } from '@anthropic-ai/sdk';

export type HistoryItem = {
  id?: string;
  msg: Anthropic.Beta.Messages.BetaMessageParam;
};

function hasCompactionBlock(msg: Anthropic.Beta.Messages.BetaMessageParam): boolean {
  return Array.isArray(msg.content) && msg.content.some((b) => b.type === 'compaction');
}

function trimToLastCompaction(items: HistoryItem[]): HistoryItem[] {
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
 * Stores the full message history forever. Compaction messages are appended
 * like any other message: they do NOT cause prior history to be dropped.
 * The full history is preserved so callers can inspect, replay, audit, or
 * roll back across compaction boundaries.
 *
 * For API requests the caller should use `cloneForRequest()`, which returns a
 * deep clone of the slice from the last compaction forward. The returned array
 * is owned by the caller and may be mutated freely (for cache_control, system
 * reminders, etc.) without affecting stored history.
 *
 * Enforces role-alternation merge for consecutive user messages.
 */
export class Conversation {
  readonly #items: HistoryItem[] = [];

  public get messages(): Anthropic.Beta.Messages.BetaMessageParam[] {
    return this.#items.map((item) => item.msg);
  }

  /**
   * Return a deep clone of the post-compaction message slice, suitable for
   * sending to the API. The returned array is owned by the caller and may be
   * mutated freely. If there is no compaction block, the entire history is
   * cloned.
   *
   * When `compactEnabled` is false and compaction blocks exist in the trimmed
   * slice, each compaction block is converted to a text block using its summary
   * content. Blocks with null content (failed compaction) are dropped. If
   * dropping blocks leaves an assistant message with no content, that message
   * is dropped too.
   */
  public cloneForRequest(compactEnabled: boolean): Anthropic.Beta.Messages.BetaMessageParam[] {
    const cloned = trimToLastCompaction(this.#items).map((item) => structuredClone(item.msg));
    if (compactEnabled) {
      return cloned;
    }
    return convertCompactionBlocks(cloned);
  }

  /**
   * Replace the entire conversation with saved messages.
   * Clears any existing history first. Does not apply merge logic: the caller
   * is responsible for providing a valid message sequence (alternating roles).
   * Id tags are not restored because they are session-scoped, not persisted.
   */
  public setHistory(msgs: Anthropic.Beta.Messages.BetaMessageParam[]): void {
    this.#items.length = 0;
    this.#items.push(...msgs.map((msg) => ({ msg })));
  }

  /**
   * Append a message, enforcing role-alternation for consecutive user messages.
   * Compaction messages are appended verbatim; prior history is never cleared.
   * @param msg  The message to append.
   * @param opts Optional. `id` tags the message for later removal via `remove(id)`.
   */
  public push(msg: Anthropic.Beta.Messages.BetaMessageParam, opts?: { id?: string }): void {
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

/**
 * Convert compaction blocks to text blocks so the API accepts them without
 * the compact beta header. Blocks with null/missing content (failed
 * compaction) are dropped. Messages left with no content blocks are dropped.
 */
function convertCompactionBlocks(messages: Anthropic.Beta.Messages.BetaMessageParam[]): Anthropic.Beta.Messages.BetaMessageParam[] {
  const result: Anthropic.Beta.Messages.BetaMessageParam[] = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) {
      result.push(msg);
      continue;
    }
    const converted: typeof msg.content = [];
    for (const block of msg.content) {
      if (block.type === 'compaction') {
        const content = (block as { content?: string | null }).content;
        if (content != null) {
          converted.push({ type: 'text', text: content });
        }
      } else {
        converted.push(block);
      }
    }
    if (converted.length > 0) {
      result.push({ ...msg, content: converted });
    }
  }
  return result;
}
