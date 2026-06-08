import type { ConsumerMessage } from '../public/types';
import type { ApprovalResponse } from './types';

export type CancelOutcome = 'none' | 'tool_cancel' | 'query_cancel';

export class ApprovalCoordinator {
  readonly #pending = new Map<string, (response: ApprovalResponse) => void>();
  #cancelled = false;
  // Non-null while a tool handler is actively running. QueryRunner registers
  // the tool's controller here so an incoming cancel can be routed to the tool
  // instead of the query. This is the coordinator's "a tool is running" signal.
  #toolController: AbortController | null = null;
  // True once the current tool run has received a cancel. A second cancel while
  // it is still set escalates to a full query-cancel.
  #toolCancelled = false;

  public get cancelled(): boolean {
    return this.#cancelled;
  }

  /**
   * Clear the cancelled flag so the same instance can be reused across queries.
   *
   * `QueryRunner` is long-lived and holds a single instance across every query,
   * so it calls `reset` at the start of each `run` to drop any `cancelled`
   * state left over from a previous cancelled query. Any stranded pending
   * approvals from a cancelled query have already been resolved by `handle`,
   * so there is nothing else to reset.
   */
  public reset(): void {
    this.#cancelled = false;
    this.#toolController = null;
    this.#toolCancelled = false;
  }

  /**
   * Mark the start of a tool run by registering the tool's controller. While a
   * controller is registered, a cancel is routed to the tool rather than the
   * query. Clearing `#toolCancelled` here scopes escalation to a single run:
   * two cancels on the same running tool escalate; one cancel each on two
   * different tools in a batch are two independent tool-cancels.
   */
  public toolRunStarted(controller: AbortController): void {
    this.#toolController = controller;
    this.#toolCancelled = false;
  }

  public toolRunFinished(): void {
    this.#toolController = null;
  }

  /**
   * Route a consumer message. The return value tells the consumer how a cancel
   * was interpreted, so it knows whether to abort the query's HTTP controller:
   *
   * - `tool_cancel`: a tool was running and this is the first cancel for it. The
   *   tool's controller is aborted; the query keeps running so the cancellation
   *   tool_result reaches the model on the next turn.
   * - `query_cancel`: no tool was running, or a tool was running and this is a
   *   second cancel for it (escalation). The query is cancelled.
   * - `none`: not a cancel.
   */
  public handle(msg: ConsumerMessage): CancelOutcome {
    if (msg.type === 'tool_approval_response') {
      const resolve = this.#pending.get(msg.requestId);
      if (resolve != null) {
        this.#pending.delete(msg.requestId);
        resolve({ approved: msg.approved, reason: msg.reason });
      }
      return 'none';
    }

    if (this.#toolController != null && !this.#toolCancelled) {
      this.#toolCancelled = true;
      this.#toolController.abort();
      return 'tool_cancel';
    }

    this.#cancelled = true;
    this.#toolController?.abort();
    for (const resolve of this.#pending.values()) {
      resolve({ approved: false, reason: 'cancelled' });
    }
    this.#pending.clear();
    return 'query_cancel';
  }

  public request(requestId: string, onRequest: () => void): Promise<ApprovalResponse> {
    return new Promise<ApprovalResponse>((resolve) => {
      this.#pending.set(requestId, resolve);
      onRequest();
    });
  }
}
