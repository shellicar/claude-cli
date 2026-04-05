import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Anthropic } from '@anthropic-ai/sdk';

type HistoryItem = {
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

export class ConversationHistory {
  readonly #items: HistoryItem[] = [];
  readonly #historyFile: string | undefined;

  public constructor(historyFile?: string) {
    this.#historyFile = historyFile;
    if (historyFile) {
      try {
        const raw = readFileSync(historyFile, 'utf-8');
        const msgs = raw
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as Anthropic.Beta.Messages.BetaMessageParam);
        this.#items.push(...trimToLastCompaction(msgs.map((msg) => ({ msg }))));
      } catch {
        // No history file yet
      }
    }
  }

  public get messages(): Anthropic.Beta.Messages.BetaMessageParam[] {
    return this.#items.map((item) => item.msg);
  }

  /**
   * Append a message to the conversation history.
   * @param msg   The message to append.
   * @param opts  Optional. `id` tags the message for later removal via `remove(id)`.
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
    this.#save();
  }

  /**
   * Remove a previously pushed message by its tag.
   * Returns `true` if found and removed, `false` if no message with that id exists.
   */
  public remove(id: string): boolean {
    const idx = this.#items.findLastIndex((item) => item.id === id);
    if (idx < 0) {
      return false;
    }
    this.#items.splice(idx, 1);
    this.#save();
    return true;
  }

  #save(): void {
    if (!this.#historyFile) {
      return;
    }
    const tmp = `${this.#historyFile}.tmp`;
    writeFileSync(tmp, this.#items.map((item) => JSON.stringify(item.msg)).join('\n'));
    renameSync(tmp, this.#historyFile);
  }
}
