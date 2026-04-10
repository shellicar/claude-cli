import type { ConsumerMessage } from '../public/types';
import type { ApprovalResponse } from './types';

export class ApprovalCoordinator {
  readonly #pending = new Map<string, (response: ApprovalResponse) => void>();
  #cancelled = false;

  public get cancelled(): boolean {
    return this.#cancelled;
  }

  /**
   * Clear the cancelled flag so the same instance can be reused across queries.
   *
   * `AgentRun` created a fresh `ApprovalState` per run, so it never needed this.
   * `QueryRunner` is long-lived and holds a single instance across every query,
   * so it calls `reset` at the start of each `run` to drop any `cancelled`
   * state left over from a previous cancelled query. Any stranded pending
   * approvals from a cancelled query have already been resolved by `handle`,
   * so there is nothing else to reset.
   */
  public reset(): void {
    this.#cancelled = false;
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
      for (const resolve of this.#pending.values()) {
        resolve({ approved: false, reason: 'cancelled' });
      }
      this.#pending.clear();
    }
  }

  public request(requestId: string, onRequest: () => void): Promise<ApprovalResponse> {
    return new Promise<ApprovalResponse>((resolve) => {
      this.#pending.set(requestId, resolve);
      onRequest();
    });
  }
}
