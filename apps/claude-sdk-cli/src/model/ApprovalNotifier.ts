import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import type { SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';
import { IProcessLauncher } from './IProcessLauncher.js';

export class ApprovalNotifier {
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  @dependsOn(IProcessLauncher) private readonly launcher!: IProcessLauncher;
  #timer: ReturnType<typeof setTimeout> | null = null;

  public start(request: SdkToolApprovalRequest): void {
    const config = this.configLoader.config.hooks.approvalNotify;
    if (config === null) {
      return;
    }
    const { command, delayMs } = config;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      try {
        this.launcher.launch(command, { stdin: JSON.stringify(request) });
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
