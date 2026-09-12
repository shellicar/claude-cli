import { randomUUID } from 'node:crypto';
import { Clock } from '@js-joda/core';
import type { SdkToolApprovalRequest, Sender } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { IBus } from '../bus/IBus.js';
import { stamp } from '../conv/wire.js';

const HEARTBEAT_MS = 15_000; // approval-spec: ~15s pulse while an ask is pending

/** Correlation to the work an ask interrupts; fields appear when they apply (approval-spec). */
export type ApprovalCorrelation = { conversationId?: string; queryId?: string; turnId?: string; toolUseId?: string };

/** The outcome of an ask, carrying who acted — published on `settled` as `by`. */
export type Settlement = { approved: boolean; by: Sender };

/** The holder's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IApprovalHolder {
  public abstract raise(req: SdkToolApprovalRequest, correlation: ApprovalCorrelation): Promise<Settlement>;
  public abstract settle(id: string, settlement: Settlement): void;
}

/**
 * Raises an ask on the wire, pulses it, serves the answer, and settles it with `by` — bridged so a wire
 * answer and a local keypress settle the same ask, first-wins. Keyed maps because a batch can raise
 * several asks in parallel.
 *
 * `approvalId` is a fresh uuid per ask (as bridge mints one), not a borrowed conversation id. The old
 * scheme reused `requestId`, which only read as an id at all while V1 gated exactly once per tool_use;
 * a V2 pipeline gates per stage, so that value becomes `toolu_x:2` — unique, but meaningless to anyone
 * reading it as a conversation id. The real tool_use id travels in `correlation.toolUseId`, which is
 * what the spec has that field for. The public API stays keyed by `requestId`: it is the caller's own
 * handle for the ask, and mapping it to the wire's `approvalId` is this class's business.
 */
export class ApprovalHolder extends IApprovalHolder {
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(Clock) private readonly clock!: Clock;
  #pulses = new Map<string, NodeJS.Timeout>();
  #serves = new Map<string, () => void>();
  #settled = new Set<string>();
  #wireAnswer = new Map<string, (s: Settlement) => void>();
  /** requestId (the caller's handle) → approvalId (the wire's subject key). */
  #approvalIds = new Map<string, string>();

  /** Raise on lifecycle, start pulsing, serve the answer. The returned promise resolves when a wire
   *  answer lands — the caller races it against the local keypress. */
  public raise(req: SdkToolApprovalRequest, correlation: ApprovalCorrelation): Promise<Settlement> {
    const id = req.requestId;
    const approvalId = randomUUID();
    this.#approvalIds.set(id, approvalId);
    this.bus.publish(`approval.v1.${approvalId}.lifecycle`, stamp(this.clock, { type: 'raised', ask: { type: 'tool_use', name: req.name, input: req.input }, correlation }));
    const pulse = setInterval(() => this.bus.publish(`approval.v1.${approvalId}.telemetry`, stamp(this.clock, { type: 'heartbeat' })), HEARTBEAT_MS);
    pulse.unref();
    this.#pulses.set(id, pulse);

    const answered = new Promise<Settlement>((resolve) => this.#wireAnswer.set(id, resolve));
    this.#serves.set(
      id,
      this.bus.serve(`approval.v1.${approvalId}.requests`, (payload) => this.#answer(id, payload)),
    );
    return answered;
  }

  #answer(id: string, payload: Uint8Array): Uint8Array {
    const reply = (r: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(r));
    if (this.#settled.has(id)) {
      return reply({ rejected: true, reason: 'already_settled' }); // the first valid answer wins
    }
    let ans: { type?: string; approved?: boolean; from?: Sender };
    try {
      ans = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return reply({ rejected: true, reason: 'invalid_answer' }); // the id is known; the payload is unparseable
    }
    if (ans.type !== 'answer' || typeof ans.approved !== 'boolean') {
      return reply({ rejected: true, reason: 'invalid_answer' }); // known id, wrong-shaped answer body
    }
    this.#wireAnswer.get(id)?.({ approved: ans.approved, by: ans.from ?? { kind: 'human' } });
    return reply({ accepted: true });
  }

  /** Settle (whichever side won): publish `settled` with `by`, stop pulsing, tear down the serve.
   *  Idempotent — the losing side's later call is a no-op. */
  public settle(id: string, settlement: Settlement): void {
    if (this.#settled.has(id)) {
      return;
    }
    this.#settled.add(id);
    const approvalId = this.#approvalIds.get(id);
    if (approvalId != null) {
      this.bus.publish(`approval.v1.${approvalId}.lifecycle`, stamp(this.clock, { type: 'settled', approved: settlement.approved, by: settlement.by }));
      this.#approvalIds.delete(id);
    }
    const pulse = this.#pulses.get(id);
    if (pulse != null) {
      clearInterval(pulse);
    }
    this.#pulses.delete(id);
    this.#serves.get(id)?.();
    this.#serves.delete(id);
    this.#wireAnswer.delete(id);
  }
}
