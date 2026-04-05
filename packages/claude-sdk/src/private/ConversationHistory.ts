import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Anthropic } from '@anthropic-ai/sdk';

type AnyBlock = { type: string };

function hasCompactionBlock(msg: Anthropic.Beta.Messages.BetaMessageParam): boolean {
  return Array.isArray(msg.content) && (msg.content as AnyBlock[]).some((b) => b.type === 'compaction');
}

function trimToLastCompaction(messages: Anthropic.Beta.Messages.BetaMessageParam[]): Anthropic.Beta.Messages.BetaMessageParam[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (hasCompactionBlock(messages[i])) {
      return messages.slice(i);
    }
  }
  return messages;
}

export class ConversationHistory {
  readonly #messages: Anthropic.Beta.Messages.BetaMessageParam[] = [];
  readonly #historyFile: string | undefined;

  public constructor(historyFile?: string) {
    this.#historyFile = historyFile;
    if (historyFile) {
      try {
        const raw = readFileSync(historyFile, 'utf-8');
        const messages = raw
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as Anthropic.Beta.Messages.BetaMessageParam);
        this.#messages.push(...trimToLastCompaction(messages));
      } catch {
        // No history file yet
      }
    }
  }

  public get messages(): Anthropic.Beta.Messages.BetaMessageParam[] {
    return this.#messages;
  }

  public push(...items: Anthropic.Beta.Messages.BetaMessageParam[]): void {
    if (items.some(hasCompactionBlock)) {
      this.#messages.length = 0;
    }
    for (const item of items) {
      const last = this.#messages.at(-1);
      if (last?.role === 'user' && item.role === 'user') {
        // Merge consecutive user messages — the API requires strict role alternation.
        const lastContent = Array.isArray(last.content) ? last.content : [{ type: 'text' as const, text: last.content as string }];
        const newContent = Array.isArray(item.content) ? item.content : [{ type: 'text' as const, text: item.content as string }];
        last.content = [...lastContent, ...newContent];
      } else {
        this.#messages.push(item);
      }
    }
    if (this.#historyFile) {
      const tmp = `${this.#historyFile}.tmp`;
      writeFileSync(tmp, this.#messages.map((m) => JSON.stringify(m)).join('\n'));
      renameSync(tmp, this.#historyFile);
    }
  }
}
