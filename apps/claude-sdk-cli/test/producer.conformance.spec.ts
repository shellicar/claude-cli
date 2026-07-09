import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Clock, Instant, ZoneOffset } from '@js-joda/core';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { MessageIdentity, SdkMessage, SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import { Conversation, IDurableConfigProvider } from '@shellicar/claude-sdk';
import { createServiceCollection } from '@shellicar/core-di-lite';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalHolder, IApprovalHolder } from '../src/approval/ApprovalHolder.js';
import { IBus } from '../src/bus/IBus.js';
import { ConvChangePublisher, IConvChangePublisher } from '../src/conv/ConvChangePublisher.js';
import { ConvTelemetryProjector, IConvTelemetryProjector } from '../src/conv/ConvTelemetryProjector.js';
import { stamp } from '../src/conv/wire.js';
import { ConversationSession } from '../src/model/ConversationSession.js';
import { SqliteSessionStore } from '../src/persistence/SqliteSessionStore.js';
import { type Captured, CapturingBus } from './CapturingBus.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

// ---------------------------------------------------------------------------
// Schema loading — validate captured bytes against the generated artifacts, not
// restatements. `additionalProperties` is permissive (add-only); Ajv strict off.
// ---------------------------------------------------------------------------

const ajv = new Ajv2020({ strict: false });
const validators = new Map<string, ReturnType<typeof ajv.compile>>();

/** `conv.v1.{id}.telemetry` → `conv.telemetry`: the concern and the kind pick the subject's schema. */
const schemaNameFor = (subject: string): string => {
  const parts = subject.split('.');
  return `${parts[0]}.${parts.at(-1)}`;
};

const validatorFor = (name: string): ReturnType<typeof ajv.compile> => {
  const cached = validators.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const schema = JSON.parse(readFileSync(new URL(`../spec/schemas/${name}.schema.json`, import.meta.url), 'utf8'));
  const validate = ajv.compile(schema);
  validators.set(name, validate);
  return validate;
};

// ---------------------------------------------------------------------------
// Fixture + capture helpers.
// ---------------------------------------------------------------------------

type FixtureLine = { subject: string; message: Record<string, unknown>; reply?: Record<string, unknown> };

const fixtureLines = (name: string): FixtureLine[] =>
  readFileSync(new URL(`../spec/fixtures/${name}.jsonl`, import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as FixtureLine);

/** The required message types on one kind of subject, in order — a producer's capture must contain them
 *  as a subsequence, extras allowed (conformance.md). */
const requiredTypesOnKind = (name: string, kind: string): string[] =>
  fixtureLines(name)
    .filter((l) => l.subject.endsWith(`.${kind}`))
    .map((l) => l.message.type as string);

const capturedTypesOnKind = (captured: Captured[], kind: string): string[] => captured.filter((c) => c.subject.endsWith(`.${kind}`)).map((c) => c.body.type as string);

const isSubsequence = (required: string[], actual: string[]): boolean => {
  let matched = 0;
  for (const type of actual) {
    if (matched < required.length && type === required[matched]) {
      matched++;
    }
  }
  return matched === required.length;
};

// ---------------------------------------------------------------------------
// The conv producer — drives the telemetry projector and change publisher
// through a capturing bus, replaying scenario 1 (the plain exchange). The
// projector reads ids off the tip, so each round's user message is pushed and
// flushed before that round's telemetry is driven.
// ---------------------------------------------------------------------------

const CONV = 'conv-abc';
const clock = Clock.fixed(Instant.parse('2026-07-07T11:00:00Z'), ZoneOffset.ofHours(10));

const durableStub = {
  get config() {
    return { model: 'claude-sonnet-4-5', thinking: false, thinkingEffort: undefined, maxTokens: 8192 };
  },
} as IDurableConfigProvider;

const identity = (messageId: string, turnId: string, from: MessageIdentity['from']): MessageIdentity => ({ messageId, turnId, queryId: 'q1', from });

function runConvProducer(): Captured[] {
  const conversation = new Conversation();
  const bus = new CapturingBus();
  const services = createServiceCollection();
  services.register(IFileSystem).to(IFileSystem, () => new MemoryFileSystem({}, '/home/user', '/project'));
  services.register(Conversation).to(Conversation, () => conversation);
  services.register(SqliteSessionStore).to(SqliteSessionStore, () => new SqliteSessionStore(new DatabaseSync(':memory:')));
  services.register(ConversationSession).to(ConversationSession);
  services.register(IBus).to(IBus, () => bus);
  services.register(Clock).to(Clock, () => clock);
  services.register(IConvChangePublisher).to(ConvChangePublisher);
  services.register(IDurableConfigProvider).to(IDurableConfigProvider, () => durableStub);
  services.register(IConvTelemetryProjector).to(ConvTelemetryProjector);
  const provider = services.buildProvider();
  const changes = provider.resolve(IConvChangePublisher);
  const projector = provider.resolve(IConvTelemetryProjector);

  const telemetry = `conv.v1.${CONV}.telemetry`;
  const drive = (msg: SdkMessage): void => {
    const body = projector.fromSdk(msg);
    if (body !== null) {
      bus.publish(telemetry, stamp(clock, body));
    }
  };

  // Round 1: user message in, a tool round, assistant tool_use out.
  conversation.push({ role: 'user', content: [{ type: 'text', text: 'read file X and summarise it' }] }, { identity: identity('m1', 't1', { kind: 'human', userId: 'stephen' }) });
  changes.flush(CONV);
  drive({ type: 'message_start' });
  drive({ type: 'tool_use_start', id: 'toolu_01ABC', name: 'ReadFile' });
  drive({ type: 'tool_use_input_stop', id: 'toolu_01ABC', input: { path: 'X' } });
  drive({ type: 'message_end', stopReason: 'tool_use' });
  drive({ type: 'message_usage', inputTokens: 1200, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 80, costUsd: 0.005, contextWindow: 200_000 });
  conversation.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_01ABC', name: 'ReadFile', input: { path: 'X' } }] }, { identity: identity('m2', 't1', { kind: 'agent' }) });
  changes.flush(CONV);

  // Round 2: tool result in, closing assistant text out.
  conversation.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01ABC', content: 'file contents' }] }, { identity: identity('m3', 't2', { kind: 'agent' }) });
  changes.flush(CONV);
  drive({ type: 'message_start' });
  drive({ type: 'message_end', stopReason: 'end_turn' });
  drive({ type: 'message_usage', inputTokens: 1400, cacheCreationTokens: 0, cacheReadTokens: 1200, outputTokens: 150, costUsd: 0.006, contextWindow: 200_000 });
  conversation.push({ role: 'assistant', content: [{ type: 'text', text: 'File X contains a summary' }] }, { identity: identity('m4', 't2', { kind: 'agent' }) });
  changes.flush(CONV);

  return bus.published;
}

// ---------------------------------------------------------------------------
// The approval producer — drives the holder's raise/pulse/settle through a
// capturing bus, replaying scenario 6a. Fake timers fire the ~15s heartbeat.
// ---------------------------------------------------------------------------

function runApprovalProducer(): Captured[] {
  const bus = new CapturingBus();
  const services = createServiceCollection();
  services.register(IBus).to(IBus, () => bus);
  services.register(Clock).to(Clock, () => clock);
  services.register(IApprovalHolder).to(ApprovalHolder);
  const holder = services.buildProvider().resolve(IApprovalHolder);

  const req = { type: 'tool_approval_request', requestId: 'apr-1', name: 'DeleteFile', input: { content: { type: 'files', values: ['./old.ts'] } } } satisfies SdkToolApprovalRequest;

  vi.useFakeTimers();
  try {
    void holder.raise(req, { conversationId: CONV, queryId: 'q2', turnId: 't3', toolUseId: 'toolu_02DEF' });
    vi.advanceTimersByTime(15_000);
    holder.settle('apr-1', { approved: true, by: { kind: 'human', userId: 'stephen' } });
  } finally {
    vi.useRealTimers();
  }
  return bus.published;
}

// ---------------------------------------------------------------------------
// Producer conformance — conv. Red against the stubs (the projector and change
// publisher throw); green once the Builder implements them.
// ---------------------------------------------------------------------------

describe('producer conformance — conv', () => {
  it('publishes every message conforming to its subject schema', () => {
    const captured = runConvProducer();
    const expected = true;
    const actual = captured.length > 0 && captured.every((c) => validatorFor(schemaNameFor(c.subject))(c.body));
    expect(actual).toBe(expected);
  });

  it('emits the fixture telemetry events as an ordered subsequence', () => {
    const captured = runConvProducer();
    const expected = true;
    const actual = isSubsequence(requiredTypesOnKind('plain-exchange', 'telemetry'), capturedTypesOnKind(captured, 'telemetry'));
    expect(actual).toBe(expected);
  });

  it('emits the fixture message commits as an ordered subsequence', () => {
    const captured = runConvProducer();
    const expected = true;
    const actual = isSubsequence(requiredTypesOnKind('plain-exchange', 'changes'), capturedTypesOnKind(captured, 'changes'));
    expect(actual).toBe(expected);
  });

  it('projects tool_use carrying the tool name', () => {
    const captured = runConvProducer();
    const expected = 'ReadFile';
    const actual = captured.map((c) => c.body).find((b) => b.type === 'tool_use')?.name;
    expect(actual).toBe(expected);
  });

  it('commits the opening user message with its sender', () => {
    const captured = runConvProducer();
    const expected = 'human';
    const first = captured.find((c) => c.subject.endsWith('.changes'))?.body as { from?: { kind?: string } } | undefined;
    const actual = first?.from?.kind;
    expect(actual).toBe(expected);
  });

  it('ends the closing round with the end_turn stop reason', () => {
    const captured = runConvProducer();
    const expected = 'end_turn';
    const actual = captured
      .map((c) => c.body)
      .filter((b) => b.type === 'turn_ended')
      .at(-1)?.stopReason;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Producer conformance — approval. Red against the stub (the holder throws).
// ---------------------------------------------------------------------------

describe('producer conformance — approval', () => {
  it('emits the ask lifecycle as raised then settled', () => {
    const captured = runApprovalProducer();
    const expected = ['raised', 'settled'];
    const actual = capturedTypesOnKind(captured, 'lifecycle');
    expect(actual).toEqual(expected);
  });

  it('pulses a heartbeat on the ask telemetry', () => {
    const captured = runApprovalProducer();
    const expected = true;
    const actual = capturedTypesOnKind(captured, 'telemetry').includes('heartbeat');
    expect(actual).toBe(expected);
  });

  it('settles carrying who acted', () => {
    const captured = runApprovalProducer();
    const expected = 'human';
    const settled = captured.map((c) => c.body).find((b) => b.type === 'settled') as { by?: { kind?: string } } | undefined;
    const actual = settled?.by?.kind;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Schema artifacts — green now. The generated schemas are the tolerance rule as
// data: known shapes strict, the fixtures valid, unknown fields permitted.
// ---------------------------------------------------------------------------

describe('conformance schema artifacts', () => {
  it('validates every event line in every fixture against its subject schema', () => {
    const fixtures = ['plain-exchange', 'cancel', 'stale-premise', 'approval-answered', 'approval-died'];
    const lines = fixtures.flatMap((name) => fixtureLines(name));
    const expected = true;
    const actual = lines.every((l) => validatorFor(schemaNameFor(l.subject))(l.message));
    expect(actual).toBe(expected);
  });

  it('validates every reply in every fixture against its concern reply schema', () => {
    const fixtures = ['plain-exchange', 'cancel', 'stale-premise', 'approval-answered'];
    const replies = fixtures.flatMap((name) => fixtureLines(name).filter((l) => l.reply !== undefined));
    const expected = true;
    const actual = replies.every((l) => validatorFor(`${l.subject.split('.')[0]}.reply`)(l.reply));
    expect(actual).toBe(expected);
  });

  it('rejects a known telemetry event missing a required field', () => {
    const expected = false;
    const actual = validatorFor('conv.telemetry')({ type: 'turn_ended', ts: '2026-07-07T21:00:00+10:00', queryId: 'q1', turnId: 't1' });
    expect(actual).toBe(expected);
  });

  it('accepts a known message carrying an unknown extra field (add-only)', () => {
    const expected = true;
    const actual = validatorFor('conv.telemetry')({ type: 'turn_ended', ts: '2026-07-07T21:00:00+10:00', queryId: 'q1', turnId: 't1', stopReason: 'end_turn', future: 'ignored' });
    expect(actual).toBe(expected);
  });
});
