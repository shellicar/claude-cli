import type { ConsumerMessage } from '../public/types';
import type { ApprovalResponse } from './types';

export class ApprovalState {
  readonly #pending = new Map<string, (response: ApprovalResponse) => void>();
  #cancelled = false;

  public get cancelled(): boolean {
    return this.#cancelled;
  }

  public handle(msg: ConsumerMessage): void {
    if (msg.type === 'tool_approval_response') {
      const resolve = this.#pending.get(msg.requestId);
      if (resolve != null) {
        this.#pending.delete(msg.requestId);
        resolve({ approved: msg.approved, reason: msg.reason });
      }
    } else if (msg.type === 'cancel') {
      this.#cancelled = true;
    }
  }

  public request(requestId: string, onRequest: () => void): Promise<ApprovalResponse> {
    return new Promise<ApprovalResponse>((resolve) => {
      this.#pending.set(requestId, resolve);
      onRequest();
    });
  }
}
