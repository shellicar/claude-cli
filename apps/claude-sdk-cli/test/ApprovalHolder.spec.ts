import { Clock } from '@js-joda/core';
import type { SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import { createServiceCollection } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { ApprovalHolder } from '../src/approval/ApprovalHolder.js';
import { IBus } from '../src/bus/IBus.js';

class RecordingBus extends IBus {
  public readonly published: { subject: string; payload: unknown }[] = [];
  public readonly served: string[] = [];
  public async start(): Promise<void> {}
  public publish(subject: string, payload: Uint8Array): void {
    this.published.push({ subject, payload: JSON.parse(new TextDecoder().decode(payload)) });
  }
  public subscribe(): () => void {
    return () => {};
  }
  public async request(): Promise<never> {
    throw new Error('not used');
  }
  public serve(subject: string): () => void {
    this.served.push(subject);
    return () => {};
  }
  public async stop(): Promise<void> {}
}

function makeHolder() {
  const bus = new RecordingBus();
  const services = createServiceCollection();
  services
    .register(IBus)
    .using(() => bus)
    .asSelf();
  services
    .register(Clock)
    .using(() => Clock.systemUTC())
    .asSelf();
  services.register(ApprovalHolder).asSelf();
  return { holder: services.buildProvider().resolve(ApprovalHolder), bus };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const stageRequest: SdkToolApprovalRequest = { type: 'tool_approval_request', requestId: 'toolu_01ABC:2', name: 'Delete', input: {}, v2: true, toolUseId: 'toolu_01ABC' };

describe('ApprovalHolder', () => {
  // The subject key is the holder's own identifier for one ask, not a borrowed id from the
  // conversation. Bridge already mints a uuid per ask; reusing a tool-use id only ever worked
  // because V1 gated once per tool_use, which a multi-stage V2 pipeline breaks.
  it('raises on a uuid subject rather than reusing the request id', () => {
    const { holder, bus } = makeHolder();

    holder.raise(stageRequest, {});

    const expected = true;
    const subject = bus.published[0].subject;
    const actual = UUID.test(subject.replace('approval.v1.', '').replace('.lifecycle', ''));
    expect(actual).toBe(expected);
  });

  // The correlation is how a bus consumer joins an ask back to the conv stream, so it has to be
  // an id that exists there. A V2 stage's requestId (`toolu_x:2`) does not.
  it('correlates to the real tool_use id, not the stage-scoped request id', () => {
    const { holder, bus } = makeHolder();

    holder.raise(stageRequest, { toolUseId: stageRequest.toolUseId });

    const expected = 'toolu_01ABC';
    const actual = (bus.published[0].payload as { correlation: { toolUseId: string } }).correlation.toolUseId;
    expect(actual).toBe(expected);
  });

  it('settles on the same subject it raised on', () => {
    const { holder, bus } = makeHolder();

    holder.raise(stageRequest, {});
    holder.settle(stageRequest.requestId, { approved: true, by: { kind: 'human' } });

    const expected = bus.published[0].subject;
    const actual = bus.published.filter((p) => p.subject.endsWith('.lifecycle')).at(-1)?.subject;
    expect(actual).toBe(expected);
  });
});
