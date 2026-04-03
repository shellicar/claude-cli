import type { Anthropic } from '@anthropic-ai/sdk';

export class ConversationHistory {
  readonly #messages: Anthropic.Beta.Messages.BetaMessageParam[] = [];

  get messages(): Anthropic.Beta.Messages.BetaMessageParam[] {
    return this.#messages;
  }

  push(...items: Anthropic.Beta.Messages.BetaMessageParam[]): void {
    this.#messages.push(...items);
  }
}
