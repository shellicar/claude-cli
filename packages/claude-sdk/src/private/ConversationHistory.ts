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
        const messages = raw
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as Anthropic.Beta.Messages.BetaMessageParam);
        this.#messages.push(...messages);
      } catch {
        // No history file yet
      }
    }
  }

  public get messages(): Anthropic.Beta.Messages.BetaMessageParam[] {
    return this.#messages;
  }

  public push(...items: Anthropic.Beta.Messages.BetaMessageParam[]): void {
    this.#messages.push(...items);
    if (this.#historyFile) {
      const tmp = `${this.#historyFile}.tmp`;
      writeFileSync(tmp, this.#messages.map((m) => JSON.stringify(m)).join('\n'));
      renameSync(tmp, this.#historyFile);
    }
  }
}
