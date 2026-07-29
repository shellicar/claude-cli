import type { InputHandler } from '../controller/InputHandler.js';
import type { View } from '../view/View.js';
import type { Presentation } from './Presentation.js';

/**
 * The conversation presentation: a render-only ConversationView plus a single handler chain. Like
 * history it has no turn phase of its own, so the chain is fixed for the presentation's lifetime.
 */
export class ConversationPresentation implements Presentation {
  readonly #view: View;
  readonly #chain: readonly InputHandler[];

  public constructor(view: View, chain: readonly InputHandler[]) {
    this.#view = view;
    this.#chain = chain;
  }

  public get view(): View {
    return this.#view;
  }

  public activeChain(): readonly InputHandler[] {
    return this.#chain;
  }
}
