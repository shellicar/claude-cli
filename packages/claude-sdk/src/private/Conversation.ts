import type { Anthropic } from '@anthropic-ai/sdk';

/** Sender provenance, carried on the wire and on the persisted record. `userId` appears only when the
 *  publisher actually knows it — never fabricated (conversation-spec / nats-spec: `from` is provenance). */
export type Sender = { kind: 'human' | 'agent' | 'orchestrator'; userId?: string };

/** The three nested ids stamped onto a message — query ⊇ turn ⊇ message — plus the sender. Optional on
 *  HistoryItem because a legacy jsonl row was written before the id model existed. */
export type MessageIdentity = { messageId: string; turnId: string; queryId: string; from: Sender };

export type HistoryItem = {
  id?: string;
  identity?: MessageIdentity;
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

  /** The id-bearing rows, for the wire (parallel to `messages`, which stays msg-only). The tip is the
   *  last item; the change and telemetry publishers read identity off it. */
  public get items(): ReadonlyArray<HistoryItem> {
    return this.#items;
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
   * The `id` removal tags are not restored (session-scoped). The `identity` (messageId/turnId/queryId
   * + from) IS restored: it rides the persisted jsonl row so the three ids survive the round-trip.
   */
  public setHistory(rows: Array<{ msg: Anthropic.Beta.Messages.BetaMessageParam; identity?: MessageIdentity }>): void {
    this.#items.length = 0;
    this.#items.push(...rows.map((row) => ({ msg: row.msg, identity: row.identity })));
  }

  /**
   * Append a message, enforcing role-alternation for consecutive user messages.
   * Compaction messages are appended verbatim; prior history is never cleared.
   * @param msg  The message to append.
   * @param opts Optional. `id` tags the message for later removal via `remove(id)`.
   */
  public push(msg: Anthropic.Beta.Messages.BetaMessageParam, opts?: { id?: string; identity?: MessageIdentity }): void {
    const last = this.#items.at(-1);
    if (last?.msg.role === 'user' && msg.role === 'user') {
      // Merge consecutive user messages — the API requires strict role alternation.
      // On merge the tag is dropped (the merged message is no longer a single addressable unit).
      const lastContent = Array.isArray(last.msg.content) ? last.msg.content : [{ type: 'text' as const, text: last.msg.content as string }];
      const newContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text' as const, text: msg.content as string }];
      last.msg = { ...last.msg, content: [...lastContent, ...newContent] };
      last.id = undefined;
    } else {
      // One row, one messageId. On merge (above) the merged-into row's identity stands; the second
      // push's is discarded. Identity is carried only on this non-merge branch. Minting is the Builder's.
      this.#items.push({ id: opts?.id, identity: opts?.identity, msg });
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

  /**
   * Remove and return the last message. Returns `undefined` if the
   * conversation is empty. Used to roll back a corrupt assistant turn (a
   * stop_reason: tool_use with no tool_use block) before resending.
   */
  public removeLast(): Anthropic.Beta.Messages.BetaMessageParam | undefined {
    return this.#items.pop()?.msg;
  }

  /**
   * Self-heal a tip left on a dangling tool_use: a prior process died after committing the
   * assistant's tool_use blocks but before their tool_result (crash, kill signal, hung tool).
   * The API rejects any request whose history ends on an unanswered tool_use, so an honest
   * synthetic result is appended for each one — never a claim about what the tool did, only
   * that it never got an answer. Uses `push`, so a real user message pushed right after merges
   * into the same row rather than sitting as its own leading message.
   * Returns `true` if a heal was applied.
   */
  public healDanglingToolUse(): boolean {
    const last = this.#items.at(-1);
    if (last?.msg.role !== 'assistant' || !Array.isArray(last.msg.content)) {
      return false;
    }
    const toolUseIds = last.msg.content.filter((b) => b.type === 'tool_use').map((b) => b.id);
    if (toolUseIds.length === 0) {
      return false;
    }
    this.push({
      role: 'user',
      content: toolUseIds.map((id) => ({
        type: 'tool_result' as const,
        tool_use_id: id,
        is_error: true,
        content: [{ type: 'text' as const, text: 'Abandoned: the CLI was restarted or crashed before this tool completed. The outcome is unknown.' }],
      })),
    });
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
