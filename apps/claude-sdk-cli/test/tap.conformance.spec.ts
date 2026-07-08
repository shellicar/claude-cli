import { readFileSync } from 'node:fs';
import { Clock, Instant, ZoneId } from '@js-joda/core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { SdkMessage } from '@shellicar/claude-sdk';
import { createServiceCollection } from '@shellicar/core-di-lite';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it, vi } from 'vitest';
import { sdkConfigSchema } from '../src/cli-config/schema.js';
import { logger } from '../src/logger.js';
import { ITap } from '../src/tap/ITap.js';
import { ITapTransport } from '../src/tap/ITapTransport.js';
import { NatsTap } from '../src/tap/NatsTap.js';
import { TapProjector } from '../src/tap/TapProjector.js';

// ---------------------------------------------------------------------------
// Artifacts under test — validated as the real files, not restatements.
// ---------------------------------------------------------------------------

const schema = JSON.parse(readFileSync(new URL('../spec/tap.v1.schema.json', import.meta.url), 'utf8'));
const fixtureEvents = readFileSync(new URL('../spec/fixtures/crash-resume.jsonl', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as Record<string, unknown>);

const ajv = new Ajv2020({ strict: false });
const validateEvent = ajv.compile(schema);

// ---------------------------------------------------------------------------
// Capture seam — records published bytes without a broker.
// ---------------------------------------------------------------------------

type Captured = { subject: string; event: Record<string, unknown> };

class CapturingTransport extends ITapTransport {
  public readonly captured: Captured[] = [];
  public async connect(): Promise<void> {}
  public publish(subject: string, payload: Uint8Array): void {
    this.captured.push({ subject, event: JSON.parse(new TextDecoder().decode(payload)) });
  }
  public async close(): Promise<void> {}
}

// Drive the crash-resume worked example's first run through the projector + tap, capturing what the
// producer publishes. Fake timers let the ~15s heartbeat fire deterministically within the run.
async function runScriptedSession(enabled: boolean): Promise<Captured[]> {
  const transport = new CapturingTransport();
  const clock = Clock.fixed(Instant.parse('2026-07-05T07:39:58Z'), ZoneId.UTC);
  const config = sdkConfigSchema.parse({
    tap: { enabled, url: 'nats://localhost:4222', label: { org: 'shellicar', mission: 'markdown-render', role: 'operator' } },
  });
  const configLoader = {
    get config() {
      return config;
    },
  } as unknown as ConfigLoader<typeof sdkConfigSchema>;

  const services = createServiceCollection();
  services.register(Clock).to(Clock, () => clock);
  services.register(ILogger).to(ILogger, () => logger);
  services.register(ITapTransport).to(ITapTransport, () => transport);
  services.register(ConfigLoader).to(ConfigLoader, () => configLoader);
  services.register(ITap).to(NatsTap);
  const tap = services.buildProvider().resolve(ITap);
  const projector = new TapProjector();

  const drive = (msg: SdkMessage): void => {
    const body = projector.fromSdk(msg);
    if (body !== null) {
      tap.publish(body);
    }
  };

  const toolInput = { content: { type: 'files', values: ['./old.ts'] } };

  vi.useFakeTimers();
  try {
    await tap.start('conv-abc');

    // Round 1: the model asks for a tool. A turn is one loop round, so this round ends `tool_use`,
    // and its own usage follows the round's stop.
    drive({ type: 'message_start' });
    drive({ type: 'tool_use_start', id: 'toolu_01ABC', name: 'DeleteFile' });
    drive({ type: 'tool_use_input_stop', id: 'toolu_01ABC', input: toolInput });
    drive({ type: 'message_end', stopReason: 'tool_use' });
    drive({ type: 'message_usage', inputTokens: 8730, cacheCreationTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 84_210, outputTokens: 310, costUsd: 0.028, contextWindow: 200_000 });

    // A human waits on the delete, so approval_pending is published from the wait point (the handler),
    // not the projector — an auto-approved tool would emit approval_settled alone. Then the user approves.
    tap.publish({ type: 'approval_pending', toolUseId: 'toolu_01ABC' });
    const settled = projector.fromConsumer({ type: 'tool_approval_response', requestId: 'toolu_01ABC', approved: true });
    if (settled !== null) {
      tap.publish(settled);
    }

    // Round 2: the tool ran; this round closes the exchange with `end_turn`, then its usage. `done`
    // follows and maps to nothing — consumers derive exchange completion from the closing stopReason.
    drive({ type: 'message_start' });
    drive({ type: 'message_end', stopReason: 'end_turn' });
    drive({ type: 'message_usage', inputTokens: 9120, cacheCreationTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 84_210, outputTokens: 640, costUsd: 0.041, contextWindow: 200_000 });
    drive({ type: 'done', stopReason: 'end_turn' });

    vi.advanceTimersByTime(15_000);
    await tap.stop('sigterm');
  } finally {
    vi.useRealTimers();
  }
  return transport.captured;
}

const typesOf = (captured: Captured[]): string[] => captured.map((c) => c.event.type as string);
const findEvent = (captured: Captured[], type: string): Record<string, unknown> | undefined => captured.map((c) => c.event).find((e) => e.type === type);

function isSubsequence(required: string[], actual: string[]): boolean {
  let matched = 0;
  for (const type of actual) {
    if (matched < required.length && type === required[matched]) {
      matched++;
    }
  }
  return matched === required.length;
}

// ---------------------------------------------------------------------------
// Producer conformance — the tap emits the spec's events, on the right subject.
// ---------------------------------------------------------------------------

describe('tap conformance — producer', () => {
  it('publishes on exactly the conversation events subject', async () => {
    const captured = await runScriptedSession(true);
    const expected = ['tap.v1.conv-abc.events'];
    const actual = [...new Set(captured.map((c) => c.subject))];
    expect(actual).toEqual(expected);
  });

  it('publishes a non-empty set of events that all conform to the v1 schema', async () => {
    const captured = await runScriptedSession(true);
    const events = captured.map((c) => c.event);
    const expected = true;
    const actual = events.length > 0 && events.every((e) => validateEvent(e));
    expect(actual).toBe(expected);
  });

  it('emits the fixture run-1 events as an ordered subsequence', async () => {
    const captured = await runScriptedSession(true);
    const required = fixtureEvents.filter((e) => e.run === 'run-12345').map((e) => e.type as string);
    const expected = true;
    const actual = isSubsequence(required, typesOf(captured));
    expect(actual).toBe(expected);
  });

  it('announces the conversation id on run_started', async () => {
    const captured = await runScriptedSession(true);
    const expected = 'conv-abc';
    const actual = findEvent(captured, 'run_started')?.conv;
    expect(actual).toBe(expected);
  });

  it('stamps the process id on run_started', async () => {
    const captured = await runScriptedSession(true);
    const expected = process.pid;
    const actual = findEvent(captured, 'run_started')?.pid;
    expect(actual).toBe(expected);
  });

  it('carries the creator label on run_started', async () => {
    const captured = await runScriptedSession(true);
    const expected = { org: 'shellicar', mission: 'markdown-render', role: 'operator' };
    const actual = findEvent(captured, 'run_started')?.label;
    expect(actual).toEqual(expected);
  });

  it('projects tool_use with the tool name', async () => {
    const captured = await runScriptedSession(true);
    const expected = 'DeleteFile';
    const actual = findEvent(captured, 'tool_use')?.name;
    expect(actual).toBe(expected);
  });

  it('projects tool_use with the input payload', async () => {
    const captured = await runScriptedSession(true);
    const expected = { content: { type: 'files', values: ['./old.ts'] } };
    const actual = findEvent(captured, 'tool_use')?.input;
    expect(actual).toEqual(expected);
  });

  it('projects approval_pending referencing the tool-use id', async () => {
    const captured = await runScriptedSession(true);
    const expected = 'toolu_01ABC';
    const actual = findEvent(captured, 'approval_pending')?.toolUseId;
    expect(actual).toBe(expected);
  });

  it('projects approval_settled with the approval decision', async () => {
    const captured = await runScriptedSession(true);
    const expected = true;
    const actual = findEvent(captured, 'approval_settled')?.approved;
    expect(actual).toBe(expected);
  });

  it('ends the mid-loop round with the tool_use stop reason', async () => {
    const captured = await runScriptedSession(true);
    const expected = 'tool_use';
    const actual = captured.map((c) => c.event).find((e) => e.type === 'turn_ended')?.stopReason;
    expect(actual).toBe(expected);
  });

  it('ends the closing round with the end_turn stop reason', async () => {
    const captured = await runScriptedSession(true);
    const expected = 'end_turn';
    const actual = captured
      .map((c) => c.event)
      .filter((e) => e.type === 'turn_ended')
      .at(-1)?.stopReason;
    expect(actual).toBe(expected);
  });

  it('does not emit an event for done', async () => {
    const captured = await runScriptedSession(true);
    const expected = false;
    const actual = typesOf(captured).includes('done');
    expect(actual).toBe(expected);
  });

  it('projects the mid-loop turn usage with its own cost', async () => {
    const captured = await runScriptedSession(true);
    const expected = 0.028;
    const actual = captured.map((c) => c.event).find((e) => e.type === 'usage')?.costUsd;
    expect(actual).toBe(expected);
  });

  it('projects the closing turn usage with its own cost', async () => {
    const captured = await runScriptedSession(true);
    const expected = 0.041;
    const actual = captured
      .map((c) => c.event)
      .filter((e) => e.type === 'usage')
      .at(-1)?.costUsd;
    expect(actual).toBe(expected);
  });

  it('emits a heartbeat on the cadence', async () => {
    const captured = await runScriptedSession(true);
    const expected = true;
    const actual = typesOf(captured).includes('heartbeat');
    expect(actual).toBe(expected);
  });

  it('announces run_ended on a clean stop', async () => {
    const captured = await runScriptedSession(true);
    const expected = 'sigterm';
    const actual = findEvent(captured, 'run_ended')?.reason;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Disabled — zero effect. Companion that makes the enabled path unsatisfiable
// without real projection: the stub satisfies this one, not the ones above.
// ---------------------------------------------------------------------------

describe('tap conformance — disabled', () => {
  it('publishes nothing when the tap is disabled', async () => {
    const captured = await runScriptedSession(false);
    const expected = 0;
    const actual = captured.length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Conversation switch — a run is process + conversation, so the CLI's /new is a
// clean run boundary: the old run ends on its own subject, a new run starts on the
// new conversation's subject, same process.
// ---------------------------------------------------------------------------

function buildTap(): { tap: ITap; captured: Captured[] } {
  const transport = new CapturingTransport();
  const clock = Clock.fixed(Instant.parse('2026-07-05T07:39:58Z'), ZoneId.UTC);
  const config = sdkConfigSchema.parse({ tap: { enabled: true, url: 'nats://localhost:4222', label: { org: 'shellicar' } } });
  const configLoader = {
    get config() {
      return config;
    },
  } as unknown as ConfigLoader<typeof sdkConfigSchema>;
  const services = createServiceCollection();
  services.register(Clock).to(Clock, () => clock);
  services.register(ILogger).to(ILogger, () => logger);
  services.register(ITapTransport).to(ITapTransport, () => transport);
  services.register(ConfigLoader).to(ConfigLoader, () => configLoader);
  services.register(ITap).to(NatsTap);
  const tap = services.buildProvider().resolve(ITap);
  return { tap, captured: transport.captured };
}

describe('tap conformance — conversation switch', () => {
  it('ends the old run on the old conversation subject with reason switched', async () => {
    const { tap, captured } = buildTap();
    await tap.start('conv-a');
    tap.switchConversation('conv-b');
    const ended = captured.find((c) => c.event.type === 'run_ended');
    const expected = { subject: 'tap.v1.conv-a.events', reason: 'switched' };
    const actual = { subject: ended?.subject, reason: ended?.event.reason };
    expect(actual).toEqual(expected);
  });

  it('announces the new run on the new conversation subject', async () => {
    const { tap, captured } = buildTap();
    await tap.start('conv-a');
    tap.switchConversation('conv-b');
    const expected = 'tap.v1.conv-b.events';
    const actual = captured.filter((c) => c.event.type === 'run_started').at(-1)?.subject;
    expect(actual).toBe(expected);
  });

  it('mints a distinct run id for the new conversation', async () => {
    const { tap, captured } = buildTap();
    await tap.start('conv-a');
    tap.switchConversation('conv-b');
    const runs = captured.filter((c) => c.event.type === 'run_started').map((c) => c.event.run);
    const expected = true;
    const actual = runs.length === 2 && runs[0] !== runs[1];
    expect(actual).toBe(expected);
  });

  it('does not publish run_ended on the new subject after the switch', async () => {
    const { tap, captured } = buildTap();
    await tap.start('conv-a');
    tap.switchConversation('conv-b');
    const expected = ['tap.v1.conv-a.events'];
    const actual = captured.filter((c) => c.event.type === 'run_ended').map((c) => c.subject);
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Schema artifact — the add-only tolerance and the strictness that leniency
// hides at runtime, per tap-testing.md.
// ---------------------------------------------------------------------------

describe('tap conformance — schema artifact', () => {
  it('accepts an unknown event type (add-only tolerance)', () => {
    const expected = true;
    const actual = validateEvent({ type: 'future_event', run: 'run-1', ts: '2026-07-05T17:39:58+10:00' });
    expect(actual).toBe(expected);
  });

  it('rejects a known event missing a required field', () => {
    const expected = false;
    const actual = validateEvent({ type: 'turn_ended', run: 'run-1', ts: '2026-07-05T17:39:58+10:00' });
    expect(actual).toBe(expected);
  });

  it('validates every event in the crash-resume fixture', () => {
    const expected = true;
    const actual = fixtureEvents.every((e) => validateEvent(e));
    expect(actual).toBe(expected);
  });
});
