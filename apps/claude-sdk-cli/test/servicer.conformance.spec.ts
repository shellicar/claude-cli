import { Clock, Instant, ZoneOffset } from '@js-joda/core';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { MessageIdentity, SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import { Conversation, IConversation } from '@shellicar/claude-sdk';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { AgentServicer, IAgentServicer } from '../src/agent/AgentServicer.js';
import { ApprovalHolder, IApprovalHolder } from '../src/approval/ApprovalHolder.js';
import { IBus } from '../src/bus/IBus.js';
import { ConvServicer, IConvServicer } from '../src/conv/ConvServicer.js';
import { IWireAttachmentLedger, WireAttachmentLedger } from '../src/conv/WireAttachmentLedger.js';
import { IWireSayInbox, WireSayInbox } from '../src/conv/WireSayInbox.js';
import { logger } from '../src/logger.js';
import { ConversationSession, IConversationSession } from '../src/model/ConversationSession.js';
import { IWorkingDirectory, WorkingDirectory } from '../src/model/WorkingDirectory.js';
import { ISqliteSessionStore, SqliteSessionStore } from '../src/persistence/SqliteSessionStore.js';
import { ConsumerChannel } from '../src/setup/ConsumerChannel.js';
import { CapturingBus } from './CapturingBus.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

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

function buildConvServicer(tip: string, bus = new CapturingBus()): IConvServicer {
  const conversation = new Conversation();
  const identity: MessageIdentity = { messageId: tip, turnId: 't2', queryId: 'q1', from: { kind: 'agent' } };
  conversation.push({ role: 'assistant', content: [{ type: 'text', text: 'File X contains a summary' }] }, { identity });

  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(Conversation)
    .using(() => conversation)
    .asSelf()
    .as(IConversation);
  services.register(WireSayInbox).as(IWireSayInbox);
  services.register(WireAttachmentLedger).as(IWireAttachmentLedger);
  services
    .register(IBus)
    .using(() => bus)
    .asSelf();
  services.register(ConsumerChannel).asSelf();
  services
    .register(ILogger)
    .using(() => logger)
    .asSelf();
  services.register(ConvServicer).as(IConvServicer);
  return services.buildProvider().resolve(IConvServicer);
}

const say = (text: string, tip: string | null): Uint8Array => encode({ ts: TS, from: { kind: 'human', userId: 'stephen' }, text, precondition: { tip } });
const cancel = (id: string): Uint8Array => encode({ ts: TS, from: { kind: 'human' }, id });
const sayWithAttachment = (tip: string, source: Record<string, unknown>): Uint8Array => encode({ ts: TS, from: { kind: 'human', userId: 'stephen' }, text: 'what does this show?', attachments: [{ type: 'image', source }], precondition: { tip } });

const handle = async (servicer: IConvServicer, payload: Uint8Array, subject: string): Promise<Reply> => decode(await servicer.handle(payload, subject));

describe('servicer conformance — conv', () => {
  it('accepts a say whose premise holds', async () => {
    const servicer = buildConvServicer('m4');
    const expected = true;
    const actual = (await handle(servicer, say('okay, delete it', 'm4'), 'conv.v2.conv-abc.requests.say')).accepted;
    expect(actual).toBe(expected);
  });

  it('returns an id for an accepted say', async () => {
    const servicer = buildConvServicer('m4');
    const expected = 'string';
    const actual = typeof (await handle(servicer, say('okay, delete it', 'm4'), 'conv.v2.conv-abc.requests.say')).id;
    expect(actual).toBe(expected);
  });

  it('rejects a say whose premise is stale', async () => {
    const servicer = buildConvServicer('m4');
    const expected = 'stale';
    const actual = (await handle(servicer, say('keep it, actually', 'm1'), 'conv.v2.conv-abc.requests.say')).reason;
    expect(actual).toBe(expected);
  });

  it('accepts a say whose attachment resolves from the bucket the block names', async () => {
    const bus = new CapturingBus();
    bus.objects.set('attach/att-7c9e', new Uint8Array([1, 2, 3]));
    const servicer = buildConvServicer('m4', bus);
    const expected = true;
    const actual = (await handle(servicer, sayWithAttachment('m4', { type: 'object', id: 'att-7c9e', bucket: 'attach', mediaType: 'image/png', size: 3 }), 'conv.v2.conv-abc.requests.say')).accepted;
    expect(actual).toBe(expected);
  });

  it('rejects a say whose fresh attachment does not resolve attachment_unavailable', async () => {
    const servicer = buildConvServicer('m4');
    const expected = 'attachment_unavailable';
    const actual = (await handle(servicer, sayWithAttachment('m4', { type: 'object', id: 'att-gone', bucket: 'attach', mediaType: 'image/png' }), 'conv.v2.conv-abc.requests.say')).reason;
    expect(actual).toBe(expected);
  });

  it('rejects a say whose attachment block names no bucket attachment_unavailable', async () => {
    const bus = new CapturingBus();
    bus.objects.set('attach/att-7c9e', new Uint8Array([1, 2, 3]));
    const servicer = buildConvServicer('m4', bus);
    const expected = 'attachment_unavailable';
    const actual = (await handle(servicer, sayWithAttachment('m4', { type: 'object', id: 'att-7c9e', mediaType: 'image/png' }), 'conv.v2.conv-abc.requests.say')).reason;
    expect(actual).toBe(expected);
  });

  it('answers cancel with no running query already_complete', async () => {
    const servicer = buildConvServicer('m4');
    const expected = 'already_complete';
    const actual = (await handle(servicer, cancel('q2'), 'conv.v2.conv-abc.requests.cancel')).reason;
    expect(actual).toBe(expected);
  });

  it('rejects a busy cancel whose id does not match the running query not_found', async () => {
    const servicer = buildConvServicer('m4');
    servicer.setBusy(true);
    const expected = 'not_found';
    const actual = (await handle(servicer, cancel('q2'), 'conv.v2.conv-abc.requests.cancel')).reason;
    expect(actual).toBe(expected);
  });

  it('accepts a busy cancel whose id matches the running query', async () => {
    const servicer = buildConvServicer('m4');
    servicer.setBusy(true);
    const expected = true;
    const actual = (await handle(servicer, cancel('q1'), 'conv.v2.conv-abc.requests.cancel')).accepted;
    expect(actual).toBe(expected);
  });

  it('answers revise unsupported', async () => {
    const servicer = buildConvServicer('m4');
    const expected = 'unsupported';
    const actual = (await handle(servicer, encode({ ts: TS, from: { kind: 'agent' }, messageId: 'm2', content: [] }), 'conv.v2.conv-abc.requests.revise')).reason;
    expect(actual).toBe(expected);
  });

  it('answers an unknown request unsupported', async () => {
    const servicer = buildConvServicer('m4');
    const expected = 'unsupported';
    const actual = (await handle(servicer, encode({ ts: TS, from: { kind: 'human' } }), 'conv.v2.conv-abc.requests.history')).reason;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// The approval servicer — the answer RPC on approval.v1.{id}.requests. The
// holder's raise registers a serve handler; the test drives it. Red against the
// stub (raise throws); green once the Builder implements raise/answer/settle.
// ---------------------------------------------------------------------------

function buildApprovalHolder(bus: CapturingBus): IApprovalHolder {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(IBus)
    .using(() => bus)
    .asSelf();
  services
    .register(Clock)
    .using(() => clock)
    .asSelf();
  services.register(ApprovalHolder).as(IApprovalHolder);
  return services.buildProvider().resolve(IApprovalHolder);
}

const answerReq = (approved: boolean): Uint8Array => encode({ type: 'answer', ts: TS, from: { kind: 'human', userId: 'stephen' }, approved });
const req = { type: 'tool_approval_request', requestId: 'apr-1', name: 'DeleteFile', input: { content: { type: 'files', values: ['./old.ts'] } } } satisfies SdkToolApprovalRequest;

describe('servicer conformance — approval', () => {
  it('accepts the first valid answer', async () => {
    const bus = new CapturingBus();
    const holder = buildApprovalHolder(bus);
    void holder.raise(req, { conversationId: 'conv-abc', toolUseId: 'toolu_02DEF' });
    const handler = bus.serves.get('approval.v1.apr-1.requests');
    const expected = true;
    const actual = handler !== undefined ? decode(await handler(answerReq(true), 'approval.v1.apr-1.requests')).accepted : undefined;
    expect(actual).toBe(expected);
  });

  it('rejects a second answer already_settled', async () => {
    const bus = new CapturingBus();
    const holder = buildApprovalHolder(bus);
    void holder.raise(req, { conversationId: 'conv-abc', toolUseId: 'toolu_02DEF' });
    const handler = bus.serves.get('approval.v1.apr-1.requests');
    if (handler !== undefined) {
      await handler(answerReq(true), 'approval.v1.apr-1.requests');
      holder.settle('apr-1', { approved: true, by: { kind: 'human', userId: 'stephen' } });
    }
    const expected = 'already_settled';
    const actual = handler !== undefined ? decode(await handler(answerReq(false), 'approval.v1.apr-1.requests')).reason : undefined;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// The agent servicer — request/reply on agent.v1.{world}.requests.*. Built over
// a fixed conversation id 'conv-abc' and a real WorkingDirectory/MemoryFileSystem
// pair, so `chdir` is driven end to end rather than merely schema-checked.
// ---------------------------------------------------------------------------

const fakeSession = (id: string): ConversationSession => ({ id }) as unknown as ConversationSession;

function buildAgentServicer(sessionId: string, fs = new MemoryFileSystem({}, '/home/user', '/repos/tower')): IAgentServicer {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(ConversationSession)
    .using(() => fakeSession(sessionId))
    .asSelf()
    .as(IConversationSession);
  // ConversationSession's own @dependsOn(IConversation)/@dependsOn(ISqliteSessionStore) are declared
  // statically, so v5's engine needs registrations even though this factory bypasses field injection.
  services.register(Conversation).asSelf().as(IConversation);
  services
    .register(SqliteSessionStore)
    .using(() => ({}) as unknown as SqliteSessionStore)
    .asSelf()
    .as(ISqliteSessionStore);
  services
    .register(IFileSystem)
    .using(() => fs)
    .asSelf();
  services.register(WorkingDirectory).asSelf().as(IWorkingDirectory);
  services.register(AgentServicer).as(IAgentServicer);
  return services.buildProvider().resolve(IAgentServicer);
}

const serviceReq = (conversationId: string): Uint8Array => encode({ ts: TS, from: { kind: 'orchestrator' }, conversationId, cwd: '~/repos/tower' });
const chdirReq = (conversationId: string, cwd: string): Uint8Array => encode({ ts: TS, from: { kind: 'human' }, conversationId, cwd });

describe('servicer conformance — agent', () => {
  it('answers service for the already-served conversation already_attached', () => {
    const servicer = buildAgentServicer('conv-abc');
    const expected = 'already_attached';
    const actual = decode(servicer.handle(serviceReq('conv-abc'), 'agent.v1.mac.requests.service')).reason;
    expect(actual).toBe(expected);
  });

  it('answers service for a different conversation unsupported', () => {
    const servicer = buildAgentServicer('conv-abc');
    const expected = 'unsupported';
    const actual = decode(servicer.handle(serviceReq('conv-other'), 'agent.v1.mac.requests.service')).reason;
    expect(actual).toBe(expected);
  });

  it('rejects a service request with no conversationId invalid', () => {
    const servicer = buildAgentServicer('conv-abc');
    const expected = 'invalid';
    const actual = decode(servicer.handle(encode({ ts: TS, from: { kind: 'orchestrator' } }), 'agent.v1.mac.requests.service')).reason;
    expect(actual).toBe(expected);
  });

  it('rejects a chdir with no cwd invalid', () => {
    const servicer = buildAgentServicer('conv-abc');
    const expected = 'invalid';
    const actual = decode(servicer.handle(encode({ ts: TS, from: { kind: 'human' }, conversationId: 'conv-abc' }), 'agent.v1.mac.requests.chdir')).reason;
    expect(actual).toBe(expected);
  });

  it('accepts drain', () => {
    const servicer = buildAgentServicer('conv-abc');
    const expected = true;
    const actual = decode(servicer.handle(encode({ ts: TS, from: { kind: 'human' } }), 'agent.v1.mac.requests.drain')).accepted;
    expect(actual).toBe(expected);
  });

  it('fires the drain event to the listener', () => {
    const servicer = buildAgentServicer('conv-abc');
    let fired = false;
    servicer.on('drain', () => {
      fired = true;
    });
    servicer.handle(encode({ ts: TS, from: { kind: 'human' } }), 'agent.v1.mac.requests.drain');
    const expected = true;
    const actual = fired;
    expect(actual).toBe(expected);
  });

  it('accepts a chdir for the served conversation and moves the directory', () => {
    const fs = new MemoryFileSystem({ '/repos/tower-wip/file.txt': 'x' }, '/home/user', '/repos/tower');
    const servicer = buildAgentServicer('conv-abc', fs);
    servicer.handle(chdirReq('conv-abc', '/repos/tower-wip'), 'agent.v1.mac.requests.chdir');
    const expected = '/repos/tower-wip';
    const actual = fs.cwd();
    expect(actual).toBe(expected);
  });

  it('accepts a chdir for the served conversation', () => {
    const servicer = buildAgentServicer('conv-abc');
    const expected = true;
    const actual = decode(servicer.handle(chdirReq('conv-abc', '/repos/tower'), 'agent.v1.mac.requests.chdir')).accepted;
    expect(actual).toBe(expected);
  });

  it('rejects a chdir for a conversation this instance does not serve not_found', () => {
    const servicer = buildAgentServicer('conv-abc');
    const expected = 'not_found';
    const actual = decode(servicer.handle(chdirReq('conv-other', '/repos/tower'), 'agent.v1.mac.requests.chdir')).reason;
    expect(actual).toBe(expected);
  });

  it('answers an unknown request unsupported', () => {
    const servicer = buildAgentServicer('conv-abc');
    const expected = 'unsupported';
    const actual = decode(servicer.handle(encode({ ts: TS, from: { kind: 'human' } }), 'agent.v1.mac.requests.status')).reason;
    expect(actual).toBe(expected);
  });
});
