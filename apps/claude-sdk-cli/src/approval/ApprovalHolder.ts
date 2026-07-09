import { Clock } from '@js-joda/core';
import type { SdkToolApprovalRequest, Sender } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';
import { IBus } from '../bus/IBus.js';

/** Correlation to the work an ask interrupts; fields appear when they apply (approval-spec). */
export type ApprovalCorrelation = { conversationId?: string; queryId?: string; turnId?: string; toolUseId?: string };

/** The outcome of an ask, carrying who acted — published on `settled` as `by`. */
export type Settlement = { approved: boolean; by: Sender };

/**
 * Stub. Raises the ask on the wire, pulses it, serves the answer, settles it with `by` — bridged so a
 * wire answer and a local keypress settle the same ask, first-wins (plan §2.2). The Builder implements
 * the lifecycle, the ~15s pulse, the per-ask serve, and the idempotent settle.
 */
export class ApprovalHolder {
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(Clock) private readonly clock!: Clock;

  /** Raise on lifecycle, start pulsing, serve the answer. The returned promise resolves when a wire
   *  answer lands — the caller races it against the local keypress. */
  public raise(req: SdkToolApprovalRequest, correlation: ApprovalCorrelation): Promise<Settlement> {
    throw new Error('not implemented');
  }

  /** Settle (whichever side won): publish `settled` with `by`, stop pulsing, tear down the serve.
   *  Idempotent — the losing side's later call is a no-op. */
  public settle(id: string, settlement: Settlement): void {
    throw new Error('not implemented');
  }
}
