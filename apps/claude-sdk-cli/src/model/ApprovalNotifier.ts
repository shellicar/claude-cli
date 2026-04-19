import type { SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import type { ApprovalNotifyConfig } from '../cli-config/types.js';

export class ApprovalNotifier {
  readonly #config: ApprovalNotifyConfig | null;

  public constructor(config: ApprovalNotifyConfig | null) {
    this.#config = config;
  }

  public start(_request: SdkToolApprovalRequest): void {
    throw new Error('not implemented');
  }

  public cancel(): void {
    throw new Error('not implemented');
  }
}
