import type { Anthropic } from '@anthropic-ai/sdk';

/** Sender provenance, carried on the wire and on the persisted record. `userId` appears only when the
 *  publisher actually knows it — never fabricated (conversation-spec / nats-spec: `from` is provenance). */
export type Sender = { kind: 'human' | 'agent' | 'orchestrator'; userId?: string };

/** The three nested ids stamped onto a message — query ⊇ turn ⊇ message — plus the sender. Optional on
 *  HistoryItem because a legacy jsonl row was written before the id model existed. */
export type MessageIdentity = { messageId: string; turnId: string; queryId: string; from: Sender };

/** `Conversation.healDanglingToolUse`'s two truthful reasons, one per call site. Session load knows
 *  the process actually restarted or crashed; the pre-request safety net only knows the tail is
 *  broken, not why — so it must not borrow load's crash-specific claim. */
export const HEAL_REASON_ABANDONED = 'Abandoned: the CLI was restarted or crashed before this tool completed. The outcome is unknown.';
export const HEAL_REASON_UNKNOWN = 'Unknown: this tool call never received a result. The outcome is unknown.';

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
/** The conversation's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConversation {
  public abstract get messages(): Anthropic.Beta.Messages.BetaMessageParam[];
  public abstract get items(): ReadonlyArray<HistoryItem>;
  public abstract cloneForRequest(compactEnabled: boolean): Anthropic.Beta.Messages.BetaMessageParam[];
  public abstract setHistory(rows: Array<{ msg: Anthropic.Beta.Messages.BetaMessageParam; identity?: MessageIdentity }>): void;
  public abstract push(msg: Anthropic.Beta.Messages.BetaMessageParam, opts?: { id?: string; identity?: MessageIdentity }): void;
  public abstract remove(id: string): boolean;
  public abstract removeLast(): Anthropic.Beta.Messages.BetaMessageParam | undefined;
  public abstract healDanglingToolUse(reason: string): boolean;
}

export class Conversation extends IConversation {
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
   * Self-heal any tool_use left without a matching tool_result: a prior process died after
   * committing the assistant's tool_use blocks but before all their tool_results (crash, kill
   * signal, hung tool), or a batch was cut short mid-approval. The API requires every tool_use
   * in an assistant message to be answered by a tool_result in the very next user message, so an
   * honest synthetic result is added for each still-missing id — never a claim about what the
   * tool did, only that it never got an answer.
   *
   * Two shapes, both anchored on the last assistant message with tool_use blocks:
   * - it is the tip itself (no reply landed at all), or
   * - it is followed by exactly one user message that already answers some but not all of
   *   its tool_use ids (a partially-drained cancelled batch).
   * Anything else (a fully-answered batch, or no tool_use at all) needs no heal.
   *
   * The synthetic blocks are prepended, never appended: the API requires every tool_result to
   * lead the user message it's part of, and the existing reply may carry other content after its
   * tool_results (a merged typed message, a clock-stamp reminder) that an append would land after.
   *
   * `reason` becomes the synthetic tool_result's text, verbatim. Callers differ in what they
   * truthfully know at their site — session load knows the process actually restarted or crashed;
   * a pre-request check knows only that the tail is broken, not why — so the reason is theirs to
   * state, not this method's to guess. Returns `true` if a heal was applied.
   */
  public healDanglingToolUse(reason: string): boolean {
    const last = this.#items.at(-1);
    if (last == null) {
      return false;
    }
    if (last.msg.role === 'assistant') {
      return this.#healMissingToolResults(last, undefined, reason);
    }
    if (last.msg.role === 'user') {
      const prev = this.#items.at(-2);
      if (prev?.msg.role === 'assistant') {
        return this.#healMissingToolResults(prev, last, reason);
      }
    }
    return false;
  }

  /** Prepend a synthetic tool_result for every tool_use id on `assistantItem` not already answered
   *  in `replyItem` (or append a brand-new reply row when there is none). */
  #healMissingToolResults(assistantItem: HistoryItem, replyItem: HistoryItem | undefined, reason: string): boolean {
    if (!Array.isArray(assistantItem.msg.content)) {
      return false;
    }
    const existingContent = replyItem != null && Array.isArray(replyItem.msg.content) ? replyItem.msg.content : [];
    const coveredIds = existingContent.filter((b): b is Extract<(typeof existingContent)[number], { type: 'tool_result' }> => b.type === 'tool_result').map((b) => b.tool_use_id);
    const missingIds = assistantItem.msg.content
      .filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use')
      .map((b) => b.id)
      .filter((id) => !coveredIds.includes(id));
    if (missingIds.length === 0) {
      return false;
    }
    const synthetic = missingIds.map((id) => ({
      type: 'tool_result' as const,
      tool_use_id: id,
      is_error: true,
      content: [{ type: 'text' as const, text: reason }],
    }));
    if (replyItem == null) {
      this.push({ role: 'user', content: synthetic });
    } else {
      replyItem.msg = { ...replyItem.msg, content: [...synthetic, ...existingContent] };
    }
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
