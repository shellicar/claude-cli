import type { InputHandler } from '../controller/InputHandler.js';
import type { PrimaryViewState } from '../model/PrimaryViewState.js';
import type { View } from '../view/View.js';
import type { Presentation } from './Presentation.js';

/**
 * The primary presentation. Its render surface is PrimaryView; its chain is
 * chosen from its own turn phase: the editor chain when awaiting input, the
 * streaming chain mid-turn. Both chains include CommandKeyHandler, so command
 * mode can be entered, navigated, and exited in either phase. The editor chain
 * adds EditorHandler (submit); the streaming chain adds CancelHandler instead,
 * placed after CommandKeyHandler so escape pops a command-mode level before it
 * cancels the running turn (decision 5 gating by composition).
 */
export class PrimaryPresentation implements Presentation {
  readonly #view: View;
  readonly #phaseState: PrimaryViewState;
  readonly #editorChain: readonly InputHandler[];
  readonly #streamingChain: readonly InputHandler[];

  public constructor(view: View, phaseState: PrimaryViewState, editorChain: readonly InputHandler[], streamingChain: readonly InputHandler[]) {
    this.#view = view;
    this.#phaseState = phaseState;
    this.#editorChain = editorChain;
    this.#streamingChain = streamingChain;
  }

  public get view(): View {
    return this.#view;
  }

  public activeChain(): readonly InputHandler[] {
    return this.#phaseState.phase === 'editor' ? this.#editorChain : this.#streamingChain;
  }
}
