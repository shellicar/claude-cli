import type { InputHandler } from '../controller/InputHandler.js';
import type { View } from '../view/View.js';
import type { Presentation } from './Presentation.js';

/**
 * The history presentation: a render-only HistoryView plus a single handler
 * chain. Unlike the primary it has no turn phase, so its chain is fixed for the
 * presentation's lifetime and activeChain returns the one it was built with.
 */
export class HistoryPresentation implements Presentation {
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
