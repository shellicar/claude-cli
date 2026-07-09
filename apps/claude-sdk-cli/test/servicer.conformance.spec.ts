import { Clock, Instant, ZoneOffset } from '@js-joda/core';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { MessageIdentity, SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import { Conversation } from '@shellicar/claude-sdk';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { ApprovalHolder, IApprovalHolder } from '../src/approval/ApprovalHolder.js';
import { IBus } from '../src/bus/IBus.js';
import { ConvServicer, IConvServicer } from '../src/conv/ConvServicer.js';
import { IWireSayInbox, WireSayInbox } from '../src/conv/WireSayInbox.js';
import { logger } from '../src/logger.js';
import { ConsumerChannel } from '../src/setup/ConsumerChannel.js';
import { CapturingBus } from './CapturingBus.js';

const TS = '2026-07-07T21:00:00+10:00';
const clock = Clock.fixed(Instant.parse('2026-07-07T11:00:00Z'), ZoneOffset.ofHours(10));

type Reply = { accepted?: boolean; id?: string; rejected?: boolean; reason?: string };

const encode = (body: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(body));
const decode = (payload: Uint8Array): Reply => JSON.parse(new TextDecoder().decode(payload)) as Reply;

// ---------------------------------------------------------------------------
// The conv servicer — request/reply on conv.v1.{id}.requests. Built over a
// conversation whose tip is `m4`, so a premise on `m4` holds and any other is
// stale. Red against the stub (handle throws); green once the Builder implements
// the reply discipline.
// ---------------------------------------------------------------------------

function buildConvServicer(tip: string): IConvServicer {
  const conversation = new Conversation();
  const identity: MessageIdentity = { messageId: tip, turnId: 't2', queryId: 'q1', from: { kind: 'agent' } };
  conversation.push({ role: 'assistant', content: [{ type: 'text', text: 'File X contains a summary' }] }, { identity });

  const services = createServiceCollection();
  services.register(Conversation).to(Conversation, () => conversation);
  services.register(IWireSayInbox).to(WireSayInbox);
  services.register(ConsumerChannel).to(ConsumerChannel);
  services.register(ILogger).to(ILogger, () => logger);
  services.register(IConvServicer).to(ConvServicer);
  return services.buildProvider().resolve(IConvServicer);
}

const say = (text: string, tip?: string): Uint8Array => encode({ type: 'say', ts: TS, from: { kind: 'human', userId: 'stephen' }, text, ...(tip !== undefined ? { precondition: { tip } } : {}) });

describe('servicer conformance — conv', () => {
  it('accepts a say whose premise holds', () => {
    const servicer = buildConvServicer('m4');
    const expected = true;
    const actual = decode(servicer.handle(say('okay, delete it', 'm4'))).accepted;
    expect(actual).toBe(expected);
  });

  it('returns an id for an accepted say', () => {
    const servicer = buildConvServicer('m4');
    const expected = 'string';
    const actual = typeof decode(servicer.handle(say('okay, delete it', 'm4'))).id;
    expect(actual).toBe(expected);
  });

  it('rejects a say whose premise is stale', () => {
    const servicer = buildConvServicer('m4');
    const expected = 'stale';
    const actual = decode(servicer.handle(say('keep it, actually', 'm1'))).reason;
    expect(actual).toBe(expected);
  });

  it('answers cancel with no running query already_complete', () => {
    const servicer = buildConvServicer('m4');
    const expected = 'already_complete';
    const actual = decode(servicer.handle(encode({ type: 'cancel', ts: TS, from: { kind: 'human' }, id: 'q2' }))).reason;
    expect(actual).toBe(expected);
  });

  it('rejects a busy cancel whose id does not match the running query not_found', () => {
    const servicer = buildConvServicer('m4');
    servicer.setBusy(true);
    const expected = 'not_found';
    const actual = decode(servicer.handle(encode({ type: 'cancel', ts: TS, from: { kind: 'human' }, id: 'q2' }))).reason;
    expect(actual).toBe(expected);
  });

  it('accepts a busy cancel whose id matches the running query', () => {
    const servicer = buildConvServicer('m4');
    servicer.setBusy(true);
    const expected = true;
    const actual = decode(servicer.handle(encode({ type: 'cancel', ts: TS, from: { kind: 'human' }, id: 'q1' }))).accepted;
    expect(actual).toBe(expected);
  });

  it('answers revise unsupported', () => {
    const servicer = buildConvServicer('m4');
    const expected = 'unsupported';
    const actual = decode(servicer.handle(encode({ type: 'revise', ts: TS, from: { kind: 'agent' }, messageId: 'm2', content: [] }))).reason;
    expect(actual).toBe(expected);
  });

  it('answers an unknown request unsupported', () => {
    const servicer = buildConvServicer('m4');
    const expected = 'unsupported';
    const actual = decode(servicer.handle(encode({ type: 'history', ts: TS, from: { kind: 'human' } }))).reason;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// The approval servicer — the answer RPC on approval.v1.{id}.requests. The
// holder's raise registers a serve handler; the test drives it. Red against the
// stub (raise throws); green once the Builder implements raise/answer/settle.
// ---------------------------------------------------------------------------

function buildApprovalHolder(bus: CapturingBus): IApprovalHolder {
  const services = createServiceCollection();
  services.register(IBus).to(IBus, () => bus);
  services.register(Clock).to(Clock, () => clock);
  services.register(IApprovalHolder).to(ApprovalHolder);
  return services.buildProvider().resolve(IApprovalHolder);
}

const answerReq = (approved: boolean): Uint8Array => encode({ type: 'answer', ts: TS, from: { kind: 'human', userId: 'stephen' }, approved });
const req = { type: 'tool_approval_request', requestId: 'apr-1', name: 'DeleteFile', input: { content: { type: 'files', values: ['./old.ts'] } } } satisfies SdkToolApprovalRequest;

describe('servicer conformance — approval', () => {
  it('accepts the first valid answer', () => {
    const bus = new CapturingBus();
    const holder = buildApprovalHolder(bus);
    void holder.raise(req, { conversationId: 'conv-abc', toolUseId: 'toolu_02DEF' });
    const handler = bus.serves.get('approval.v1.apr-1.requests');
    const expected = true;
    const actual = handler !== undefined ? decode(handler(answerReq(true))).accepted : undefined;
    expect(actual).toBe(expected);
  });

  it('rejects a second answer already_settled', () => {
    const bus = new CapturingBus();
    const holder = buildApprovalHolder(bus);
    void holder.raise(req, { conversationId: 'conv-abc', toolUseId: 'toolu_02DEF' });
    const handler = bus.serves.get('approval.v1.apr-1.requests');
    if (handler !== undefined) {
      handler(answerReq(true));
      holder.settle('apr-1', { approved: true, by: { kind: 'human', userId: 'stephen' } });
    }
    const expected = 'already_settled';
    const actual = handler !== undefined ? decode(handler(answerReq(false))).reason : undefined;
    expect(actual).toBe(expected);
  });
});
