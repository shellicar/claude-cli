import type { SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import type { ApprovalNotifyConfig } from '../cli-config/types.js';
import type { IProcessLauncher } from './IProcessLauncher.js';

export class ApprovalNotifier {
  readonly #config: ApprovalNotifyConfig | null;
  readonly #launcher: IProcessLauncher;
  #timer: ReturnType<typeof setTimeout> | null = null;

  public constructor(config: ApprovalNotifyConfig | null, launcher: IProcessLauncher) {
    this.#config = config;
    this.#launcher = launcher;
  }

  public start(request: SdkToolApprovalRequest): void {
    if (this.#config === null) {
      return;
    }
    const { command, delayMs } = this.#config;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      try {
        this.#launcher.launch(command, { stdin: JSON.stringify(request) });
      } catch {
        // fire and forget
      }
    }, delayMs);
  }

  public cancel(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}
