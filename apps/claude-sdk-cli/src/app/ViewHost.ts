import type { KeyAction } from '@shellicar/claude-core/input';
import type { AppModeKey, AppModeState } from '../model/AppModeState.js';
import type { TerminalRenderer } from '../view/TerminalRenderer.js';
import type { ViewModel } from '../view/View.js';
import type { Presentation } from './Presentation.js';

/**
 * The render coordinator. Subscribes to every store; on change schedules one
 * paint per tick (setImmediate coalesces bursts). Render and key dispatch both
 * resolve two layers: AppModeState picks the active Presentation; the
 * Presentation picks its own chain via activeChain(). Holds no view or chain of
 * its own.
 *
 * A fixed render-level debounce was tried here to coalesce rapid streaming
 * deltas, but it delays every render source equally — including keystrokes,
 * which don't need it and felt noticeably laggier for it. Reverted: the render
 * path stays immediate (one paint per tick), and the streaming-specific cost is
 * throttled at its actual source instead (see renderStreamingMarkdown in
 * renderConversation.ts, which decorates on a period and appends raw text
 * in between, rather than debouncing the paint itself).
 */
export class ViewHost implements Disposable {
  readonly #renderer: TerminalRenderer;
  readonly #model: ViewModel;
  readonly #presentations: ReadonlyMap<AppModeKey, Presentation>;
  readonly #appModeState: AppModeState;
  readonly #onChange: () => void;
  #renderPending = false;
  #disposed = false;

  public constructor(renderer: TerminalRenderer, model: ViewModel, presentations: ReadonlyMap<AppModeKey, Presentation>, appModeState: AppModeState) {
    this.#renderer = renderer;
    this.#model = model;
    this.#presentations = presentations;
    this.#appModeState = appModeState;
    this.#onChange = () => this.scheduleRender();

    model.conversationState.on('change', this.#onChange);
    model.editorState.on('change', this.#onChange);
    model.toolApprovalState.on('change', this.#onChange);
    model.commandModeState.on('change', this.#onChange);
    model.statusState.on('change', this.#onChange);
    model.terminalState.on('change', this.#onChange);
    model.primaryViewState.on('change', this.#onChange);
    model.scrollState.on('change', this.#onChange);
    model.historyViewState.on('change', this.#onChange);
    appModeState.on('change', this.#onChange);
  }

  public [Symbol.dispose](): void {
    this.#disposed = true;
    this.#model.conversationState.off('change', this.#onChange);
    this.#model.editorState.off('change', this.#onChange);
    this.#model.toolApprovalState.off('change', this.#onChange);
    this.#model.commandModeState.off('change', this.#onChange);
    this.#model.statusState.off('change', this.#onChange);
    this.#model.terminalState.off('change', this.#onChange);
    this.#model.primaryViewState.off('change', this.#onChange);
    this.#model.scrollState.off('change', this.#onChange);
    this.#model.historyViewState.off('change', this.#onChange);
    this.#appModeState.off('change', this.#onChange);
  }

  #activePresentation(): Presentation {
    const presentation = this.#presentations.get(this.#appModeState.active);
    if (!presentation) {
      throw new Error(`No Presentation registered for '${this.#appModeState.active}'`);
    }
    return presentation;
  }

  public dispatchKey(key: KeyAction): void {
    for (const handler of this.#activePresentation().activeChain()) {
      if (handler.handleKey(key)) {
        return;
      }
    }
  }

  public renderNow(): void {
    if (this.#disposed) {
      return;
    }
    const rows = this.#activePresentation().view.render(this.#model);
    this.#renderer.paint(rows);
  }

  public scheduleRender(): void {
    if (this.#renderPending) {
      return;
    }
    this.#renderPending = true;
    setImmediate(() => {
      this.#renderPending = false;
      this.renderNow();
    });
  }
}
