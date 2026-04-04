import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Anthropic } from '@anthropic-ai/sdk';

export class ConversationHistory {
  readonly #messages: Anthropic.Beta.Messages.BetaMessageParam[] = [];
  readonly #historyFile: string | undefined;

  public constructor(historyFile?: string) {
    this.#historyFile = historyFile;
    if (historyFile) {
      try {
        const raw = readFileSync(historyFile, 'utf-8');
        this.#messages.push(...(JSON.parse(raw) as Anthropic.Beta.Messages.BetaMessageParam[]));
      } catch {
        // No history file yet
      }
    }
  }

  get messages(): Anthropic.Beta.Messages.BetaMessageParam[] {
    return this.#messages;
  }

  push(...items: Anthropic.Beta.Messages.BetaMessageParam[]): void {
    this.#messages.push(...items);
    if (this.#historyFile) {
      const tmp = `${this.#historyFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.#messages));
      renameSync(tmp, this.#historyFile);
    }
  }
}
