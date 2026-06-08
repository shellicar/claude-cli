import type { ToolApprovalState } from '../model/ToolApprovalState.js';

/**
 * Drives the approval-flash phase. Subscribes to ToolApprovalState; while
 * approvals are pending, ticks every 500ms and toggles flash phase (which
 * emits change and repaints). Replaces AppLayout.#startFlash/#stopFlash.
 */
export class Flasher implements Disposable {
  readonly #state: ToolApprovalState;
  readonly #onChange: () => void;
  #interval: ReturnType<typeof setInterval> | undefined;

  public constructor(state: ToolApprovalState) {
    this.#state = state;
    this.#onChange = () => this.#reconcile();
    this.#state.on('change', this.#onChange);
  }

  public [Symbol.dispose](): void {
    this.#state.off('change', this.#onChange);
    this.#stop();
  }

  #reconcile(): void {
    if (this.#state.hasPendingApprovals && this.#interval === undefined) {
      this.#start();
    } else if (!this.#state.hasPendingApprovals && this.#interval !== undefined) {
      this.#stop();
    }
  }

  #start(): void {
    this.#interval = setInterval(() => {
      this.#state.toggleFlash();
    }, 500);
  }

  #stop(): void {
    if (this.#interval !== undefined) {
      clearInterval(this.#interval);
      this.#interval = undefined;
    }
  }
}
