import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Clock, Instant, ZoneOffset } from '@js-joda/core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { MessageIdentity, SdkMessage, SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import { Conversation, IConversation, IDurableConfigProvider } from '@shellicar/claude-sdk';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it, vi } from 'vitest';
import { AgentPresence, IAgentPresence } from '../src/agent/AgentPresence.js';
import { ApprovalHolder, IApprovalHolder } from '../src/approval/ApprovalHolder.js';
import { IBus } from '../src/bus/IBus.js';
import { ConvChangePublisher, IConvChangePublisher } from '../src/conv/ConvChangePublisher.js';
import { ConvTelemetryProjector, IConvTelemetryProjector } from '../src/conv/ConvTelemetryProjector.js';
import { telemetryLeaf } from '../src/conv/telemetryLeaf.js';
import { IWireAttachmentLedger, WireAttachmentLedger } from '../src/conv/WireAttachmentLedger.js';
import { stamp } from '../src/conv/wire.js';
import { logger } from '../src/logger.js';
import { ConversationSession, IConversationSession } from '../src/model/ConversationSession.js';
import { ISqliteSessionStore, SqliteSessionStore } from '../src/persistence/SqliteSessionStore.js';
import { type Captured, CapturingBus } from './CapturingBus.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

// ---------------------------------------------------------------------------
// Schema loading — validate captured bytes against the generated artifacts, not
// restatements. `additionalProperties` is permissive (add-only); Ajv strict off.
// ---------------------------------------------------------------------------

const ajv = new Ajv2020({ strict: false });
const validators = new Map<string, ReturnType<typeof ajv.compile>>();

/** Everything after the id, concern-qualified (and version-qualified for v2, since v1 and v2 schema
 *  files sit side by side), names the schema file: `conv.v1.{id}.telemetry` → `conv.telemetry`;
 *  `agent.v1.{world}.telemetry.ready` → `agent.telemetry.ready`; `conv.v2.{id}.telemetry.turn.started`
 *  → `conv.v2.telemetry.turn.started`. */
const schemaNameFor = (subject: string): string => {
  const [concern, version, , ...rest] = subject.split('.');
  const versionPrefix = version === 'v2' ? 'v2.' : '';
  return `${concern}.${versionPrefix}${rest.join('.')}`;
};

const validatorFor = (name: string): ReturnType<typeof ajv.compile> => {
  const cached = validators.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const schema = JSON.parse(readFileSync(new URL(`./spec/schemas/${name}.schema.json`, import.meta.url), 'utf8'));
  const validate = ajv.compile(schema);
  validators.set(name, validate);
  return validate;
};

/** Fixture-line validation: a subject with no schema artifact is a leaf this build does not speak
 *  (e.g. the retained v1-speaker attachment fixtures) — skipped, never failed (conformance.md). A
 *  producer's own capture stays strict: everything it publishes must have a schema. */
const fixtureLineValid = (subject: string, message: Record<string, unknown>): boolean => {
  const name = schemaNameFor(subject);
  if (!existsSync(new URL(`./spec/schemas/${name}.schema.json`, import.meta.url))) {
    return true;
  }
  return validatorFor(name)(message) === true;
};

// ---------------------------------------------------------------------------
// Fixture + capture helpers.
// ---------------------------------------------------------------------------

type FixtureLine = { subject: string; message: Record<string, unknown>; reply?: Record<string, unknown> };

const fixtureLines = (name: string, dir = '.'): FixtureLine[] =>
  readFileSync(new URL(`./spec/fixtures/${dir}/${name}.jsonl`, import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as FixtureLine);

/** v2 (and agent) route by subject leaf, never a body `type` — the "type" of a line for subsequence
 *  comparison is everything after the class token (`telemetry`/`changes`/`requests`). `deltas` is the
 *  one flat exception and keeps `type` in the body. */
const leafOf = (subject: string): string => {
  const tokens = subject.split('.');
  const classToken = tokens[3];
  return classToken === 'deltas' ? classToken : tokens.slice(4).join('.');
};

/** The required leaves on one class of subject, in order — a producer's capture must contain them as a
 *  subsequence, extras allowed (conformance.md). */
const requiredLeavesOnClass = (name: string, dir: string, cls: string): string[] =>
  fixtureLines(name, dir)
    .filter((l) => l.subject.split('.')[3] === cls)
    .map((l) => leafOf(l.subject));

const capturedLeavesOnClass = (captured: Captured[], cls: string): string[] => captured.filter((c) => c.subject.split('.')[3] === cls).map((c) => leafOf(c.subject));

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
const WORLD = 'mac';
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
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(IFileSystem)
    .using(() => new MemoryFileSystem({}, '/home/user', '/project'))
    .asSelf();
  services
    .register(Conversation)
    .using(() => conversation)
    .asSelf()
    .as(IConversation);
  services
    .register(SqliteSessionStore)
    .using(() => new SqliteSessionStore(new DatabaseSync(':memory:'), logger))
    .asSelf()
    .as(ISqliteSessionStore);
  services.register(ConversationSession).asSelf().as(IConversationSession);
  services
    .register(IBus)
    .using(() => bus)
    .asSelf();
  services
    .register(Clock)
    .using(() => clock)
    .asSelf();
  services
    .register(IAgentPresence)
    .using(() => ({ instanceId: 'inst-test', world: WORLD, boot: () => {}, attach: () => {}, move: () => {}, detach: () => {}, hasClaim: () => true, stop: () => {} }) as IAgentPresence)
    .asSelf();
  services.register(WireAttachmentLedger).as(IWireAttachmentLedger);
  services.register(ConvChangePublisher).as(IConvChangePublisher);
  services
    .register(IDurableConfigProvider)
    .using(() => durableStub)
    .asSelf();
  services.register(ConvTelemetryProjector).as(IConvTelemetryProjector);
  const provider = services.buildProvider();
  const changes = provider.resolve(IConvChangePublisher);
  const projector = provider.resolve(IConvTelemetryProjector);

  const drive = (msg: SdkMessage): void => {
    const body = projector.fromSdk(msg);
    if (body !== null) {
      const { leaf, rest } = telemetryLeaf(body);
      bus.publish(`conv.v2.${CONV}.telemetry.${leaf}`, stamp(clock, rest));
    }
  };

  // Round 1: user message in, a tool round, assistant tool_use out.
  conversation.push({ role: 'user', content: [{ type: 'text', text: 'read file X and summarise it' }] }, { identity: identity('m1', 't1', { kind: 'human', userId: 'stephen' }) });
  changes.flush(CONV);
  drive({ type: 'message_start' });
  drive({ type: 'tool_use_start', id: 'toolu_01ABC', name: 'ReadFile' });
  drive({ type: 'tool_use_input_stop', id: 'toolu_01ABC', input: { path: 'X' } });
  drive({ type: 'message_end', stopReason: 'tool_use' });
  drive({ type: 'message_usage', inputTokens: 1200, cacheCreationTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0, outputTokens: 80, costUsd: 0.005, contextWindow: 200_000 });
  conversation.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_01ABC', name: 'ReadFile', input: { path: 'X' } }] }, { identity: identity('m2', 't1', { kind: 'agent' }) });
  changes.flush(CONV);

  // Round 2: tool result in, closing assistant text out.
  conversation.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01ABC', content: 'file contents' }] }, { identity: identity('m3', 't2', { kind: 'agent' }) });
  changes.flush(CONV);
  drive({ type: 'message_start' });
  drive({ type: 'message_end', stopReason: 'end_turn' });
  drive({ type: 'message_usage', inputTokens: 1400, cacheCreationTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 1200, outputTokens: 150, costUsd: 0.006, contextWindow: 200_000 });
  conversation.push({ role: 'assistant', content: [{ type: 'text', text: 'File X contains a summary' }] }, { identity: identity('m4', 't2', { kind: 'agent' }) });
  changes.flush(CONV);
  changes.closeQuery(CONV, 'q1', 'completed');

  return bus.published;
}

// ---------------------------------------------------------------------------
// The approval producer — drives the holder's raise/pulse/settle through a
// capturing bus, replaying scenario 6a. Fake timers fire the ~15s heartbeat.
// ---------------------------------------------------------------------------

function runApprovalProducer(): Captured[] {
  const bus = new CapturingBus();
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
// The agent producer — drives AgentPresence's boot/attach/detach through a
// capturing bus, replaying scenario a1 (ready, pulse, attached) then a2's tail
// (detached). Fake timers fire the pulse on the configured interval.
// ---------------------------------------------------------------------------

const fakeConfigLoader = (world: string, pulseIntervalS: number): ConfigLoader<any> =>
  ({
    get config() {
      return { nats: { world, pulseIntervalS } };
    },
  }) as unknown as ConfigLoader<any>;

function runAgentProducer(): Captured[] {
  const bus = new CapturingBus();
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(IBus)
    .using(() => bus)
    .asSelf();
  services
    .register(Clock)
    .using(() => clock)
    .asSelf();
  services
    .register(ConfigLoader)
    .using(() => fakeConfigLoader(WORLD, 30))
    .asSelf();
  services.register(AgentPresence).as(IAgentPresence);
  const presence = services.buildProvider().resolve(IAgentPresence);

  vi.useFakeTimers();
  try {
    presence.boot();
    vi.advanceTimersByTime(30_000);
    presence.attach(CONV, '~/repos/tower', 'm12');
    presence.attach(CONV, '~/repos/tower', 'm12'); // re-call while the claim is open: must publish nothing
    presence.move(CONV, '~/repos/tower/mvp');
    presence.detach(CONV);
  } finally {
    vi.useRealTimers();
  }
  return bus.published;
}

describe('producer conformance — agent', () => {
  it('publishes every message conforming to its subject schema', () => {
    const captured = runAgentProducer();
    const expected = true;
    const actual = captured.length > 0 && captured.every((c) => validatorFor(schemaNameFor(c.subject))(c.body));
    expect(actual).toBe(expected);
  });

  it('emits ready then pulse on the world telemetry tree', () => {
    const captured = runAgentProducer();
    const expected = true;
    const actual = isSubsequence(['ready', 'pulse'], capturedLeavesOnClass(captured, 'telemetry'));
    expect(actual).toBe(expected);
  });

  it('publishes the claim lifecycle on the conversation attachment leaf, exactly once per claim', () => {
    const captured = runAgentProducer();
    const expected = ['attached', 'moved', 'detached'];
    const actual = capturedLeavesOnClass(captured, 'attachment');
    expect(actual).toEqual(expected);
  });

  it('publishes attachment claims on the conversation tree, never the world tree', () => {
    const captured = runAgentProducer();
    const expected = 0;
    const actual = captured.filter((c) => c.subject.startsWith('agent.v1.') && (c.subject.endsWith('.attached') || c.subject.endsWith('.detached'))).length;
    expect(actual).toBe(expected);
  });

  it('carries the same instanceId on ready, pulse, and the claim events', () => {
    const captured = runAgentProducer();
    const ids = new Set(captured.map((c) => c.body.instanceId).filter((v) => v !== undefined));
    const expected = 1;
    const actual = ids.size;
    expect(actual).toBe(expected);
  });

  it('attaches carrying the identity pair, cwd, and tip', () => {
    const captured = runAgentProducer();
    const expected = { world: WORLD, cwd: '~/repos/tower', tip: 'm12' };
    const attached = captured.find((c) => c.subject === `conv.v2.${CONV}.attachment.attached`)?.body as { world?: string; cwd?: string; tip?: string } | undefined;
    const actual = { world: attached?.world, cwd: attached?.cwd, tip: attached?.tip };
    expect(actual).toEqual(expected);
  });

  it('attaches carrying the pulse interval, so a late joiner between pulses still learns the promise', () => {
    const captured = runAgentProducer();
    const expected = 30;
    const actual = captured.find((c) => c.subject === `conv.v2.${CONV}.attachment.attached`)?.body.intervalS;
    expect(actual).toBe(expected);
  });

  it('publishes moved carrying the new cwd on a directory change under the open claim', () => {
    const captured = runAgentProducer();
    const expected = '~/repos/tower/mvp';
    const actual = captured.find((c) => c.subject === `conv.v2.${CONV}.attachment.moved`)?.body.cwd;
    expect(actual).toBe(expected);
  });

  it('detaches carrying the identity pair', () => {
    const captured = runAgentProducer();
    const expected = { instanceId: true, world: WORLD };
    const detached = captured.find((c) => c.subject === `conv.v2.${CONV}.attachment.detached`)?.body as { instanceId?: string; world?: string } | undefined;
    const actual = { instanceId: detached?.instanceId !== undefined, world: detached?.world };
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Producer conformance — conv (v2). Red against the stubs (the projector and
// change publisher throw); green once the Builder implements them.
// ---------------------------------------------------------------------------

describe('producer conformance — conv v2', () => {
  it('publishes every message conforming to its subject schema', () => {
    const captured = runConvProducer();
    const expected = true;
    const actual = captured.length > 0 && captured.every((c) => validatorFor(schemaNameFor(c.subject))(c.body));
    expect(actual).toBe(expected);
  });

  it('emits the fixture telemetry events as an ordered subsequence', () => {
    const captured = runConvProducer();
    const expected = true;
    const actual = isSubsequence(requiredLeavesOnClass('scenario-1', 'v2', 'telemetry'), capturedLeavesOnClass(captured, 'telemetry'));
    expect(actual).toBe(expected);
  });

  it('emits the fixture message and query-closure commits as an ordered subsequence', () => {
    const captured = runConvProducer();
    const expected = true;
    const actual = isSubsequence(requiredLeavesOnClass('scenario-1', 'v2', 'changes'), capturedLeavesOnClass(captured, 'changes'));
    expect(actual).toBe(expected);
  });

  it('projects tool_use carrying the tool name', () => {
    const captured = runConvProducer();
    const expected = 'ReadFile';
    const actual = captured.find((c) => c.subject.endsWith('.telemetry.tool.use'))?.body.name;
    expect(actual).toBe(expected);
  });

  it('commits the opening user message with its sender', () => {
    const captured = runConvProducer();
    const expected = 'human';
    const first = captured.find((c) => c.subject.endsWith('.changes.message'))?.body as { from?: { kind?: string } } | undefined;
    const actual = first?.from?.kind;
    expect(actual).toBe(expected);
  });

  it('carries the publishing instance id as envelope provenance on every change', () => {
    const captured = runConvProducer();
    const expected = true;
    const changes = captured.filter((c) => c.subject.includes('.changes.'));
    const actual = changes.length > 0 && changes.every((c) => c.body.instanceId === 'inst-test');
    expect(actual).toBe(expected);
  });

  it('commits a tool_result delivery without a fabricated sender', () => {
    const captured = runConvProducer();
    const toolResult = captured.map((c) => c.body).find((b) => Array.isArray(b.content) && (b.content as { type?: string }[]).some((block) => block.type === 'tool_result'));
    const expected = undefined;
    const actual = toolResult?.from;
    expect(actual).toBe(expected);
  });

  it('ends the closing round with the end_turn stop reason', () => {
    const captured = runConvProducer();
    const expected = 'end_turn';
    const actual = captured
      .filter((c) => c.subject.endsWith('.telemetry.turn.ended'))
      .map((c) => c.body)
      .at(-1)?.stopReason;
    expect(actual).toBe(expected);
  });

  it('closes the query with reason completed once the closing message has landed', () => {
    const captured = runConvProducer();
    const expected = 'completed';
    const actual = captured.find((c) => c.subject.endsWith('.changes.query'))?.body.reason;
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
    const actual = captured.filter((c) => c.subject.endsWith('.lifecycle')).map((c) => c.body.type);
    expect(actual).toEqual(expected);
  });

  it('pulses a heartbeat on the ask telemetry', () => {
    const captured = runApprovalProducer();
    const expected = true;
    const actual = captured.filter((c) => c.subject.endsWith('.telemetry')).some((c) => c.body.type === 'heartbeat');
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
  it('validates every event line in every v1 fixture against its subject schema', () => {
    const fixtures = ['scenario-1', 'scenario-2', 'scenario-2b', 'scenario-3', 'scenario-4', 'scenario-5', 'scenario-6a', 'scenario-6b', 'scenario-7', 'scenario-8a', 'scenario-8b'];
    const lines = fixtures.flatMap((name) => fixtureLines(name));
    const expected = true;
    const actual = lines.every((l) => fixtureLineValid(l.subject, l.message));
    expect(actual).toBe(expected);
  });

  it('validates every reply in every v1 fixture against its concern reply schema', () => {
    const fixtures = ['scenario-1', 'scenario-2', 'scenario-2b', 'scenario-3', 'scenario-6a', 'scenario-8a', 'scenario-8b'];
    const replies = fixtures.flatMap((name) => fixtureLines(name).filter((l) => l.reply !== undefined));
    const expected = true;
    const actual = replies.every((l) => validatorFor(`${l.subject.split('.')[0]}.reply`)(l.reply));
    expect(actual).toBe(expected);
  });

  it('validates every event line in every v2 conv fixture against its subject schema', () => {
    const fixtures = ['scenario-1', 'scenario-2', 'scenario-2b', 'scenario-3', 'scenario-4', 'scenario-5', 'scenario-7', 'scenario-8a', 'scenario-8b'];
    const lines = fixtures.flatMap((name) => fixtureLines(name, 'v2'));
    const expected = true;
    const actual = lines.every((l) => fixtureLineValid(l.subject, l.message));
    expect(actual).toBe(expected);
  });

  it('validates every reply in every v2 conv fixture against the v2 reply schema', () => {
    const fixtures = ['scenario-1', 'scenario-2', 'scenario-2b', 'scenario-5', 'scenario-8a', 'scenario-8b'];
    const replies = fixtures.flatMap((name) => fixtureLines(name, 'v2').filter((l) => l.reply !== undefined));
    const expected = true;
    const actual = replies.every((l) => validatorFor('conv.v2.reply')(l.reply));
    expect(actual).toBe(expected);
  });

  it('validates every event line in every agent fixture against its subject schema', () => {
    const fixtures = ['scenario-a1', 'scenario-a2', 'scenario-a3', 'scenario-a4', 'scenario-a5', 'scenario-a6', 'scenario-a7', 'scenario-a8', 'scenario-a9', 'scenario-a10'];
    const lines = fixtures.flatMap((name) => fixtureLines(name, 'agent'));
    const expected = true;
    const actual = lines.every((l) => fixtureLineValid(l.subject, l.message));
    expect(actual).toBe(expected);
  });

  it('validates every reply in every agent fixture against the agent reply schema', () => {
    const fixtures = ['scenario-a2', 'scenario-a4', 'scenario-a5'];
    const replies = fixtures.flatMap((name) => fixtureLines(name, 'agent').filter((l) => l.reply !== undefined));
    const expected = true;
    const actual = replies.every((l) => validatorFor('agent.reply')(l.reply));
    expect(actual).toBe(expected);
  });

  it('validates the new-leaf attachment fixture lines against the conv.v2 attachment schemas strictly', () => {
    const lines = ['scenario-a6', 'scenario-a7', 'scenario-a8', 'scenario-a9', 'scenario-a10'].flatMap((name) => fixtureLines(name, 'agent')).filter((l) => l.subject.includes('.attachment.'));
    const expected = true;
    const actual = lines.length > 0 && lines.every((l) => validatorFor(schemaNameFor(l.subject))(l.message) === true);
    expect(actual).toBe(expected);
  });

  it('rejects a known telemetry event missing a required field', () => {
    const expected = false;
    const actual = validatorFor('conv.v2.telemetry.turn.ended')({ ts: '2026-07-07T21:00:00+10:00', queryId: 'q1', turnId: 't1' });
    expect(actual).toBe(expected);
  });

  it('accepts a known message carrying an unknown extra field (add-only)', () => {
    const expected = true;
    const actual = validatorFor('conv.v2.telemetry.turn.ended')({ ts: '2026-07-07T21:00:00+10:00', queryId: 'q1', turnId: 't1', stopReason: 'end_turn', future: 'ignored' });
    expect(actual).toBe(expected);
  });
});
