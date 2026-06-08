import type { InputHandler } from '../controller/InputHandler.js';
import type { View } from '../view/View.js';

/**
 * A presentation: a render-only View plus the handler chain currently active.
 * The presentation owns its sub-state and selects its own chain from it
 * (decision 3). ViewHost asks for `view` to render and `activeChain()` to
 * dispatch keys; it does not know how the presentation chooses its chain.
 */
export interface Presentation {
  readonly view: View;
  activeChain(): readonly InputHandler[];
}
