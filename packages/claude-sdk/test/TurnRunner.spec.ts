import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import { Clock, Instant, type ZoneId, ZoneOffset } from '@js-joda/core';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IRandomProvider } from '@shellicar/claude-core/providers/IRandomProvider';
import { ISleepProvider } from '@shellicar/claude-core/providers/ISleepProvider';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMIT_BUDGET_MS, BASE_DELAY_MS, MAX_RETRIES, RETRY_AFTER_CAP_MS, STREAM_INTERRUPT_DELAY_MS, STREAM_INTERRUPT_MAX_RETRIES } from '../src/private/backoff.js';
import { Conversation } from '../src/private/Conversation.js';
import { AccountLimitStoppedError, ConnectionError, HttpError, StreamInterruptedError } from '../src/private/http/errors.js';
import { type IMessageStream, IMessageStreamer } from '../src/private/MessageStreamer.js';
import { TurnRunner } from '../src/private/TurnRunner.js';
import type { MessageStreamResult } from '../src/private/types.js';
import { IStreamProcessor, IWakeLock } from '../src/public/interfaces.js';
import type { DurableConfig, WakeLockHandle } from '../src/public/types.js';
import { AccountLimitListener, StreamInterruptListener } from '../src/public/types.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeStreamer extends IMessageStreamer {
  public readonly calls: { body: BetaMessageStreamParams; options: Anthropic.RequestOptions }[] = [];

  public stream(body: BetaMessageStreamParams, options: Anthropic.RequestOptions): IMessageStream {
    this.calls.push({ body, options });
    return (async function* () {})();
  }
}

class FakeProcessor extends IStreamProcessor {
  public calls = 0;
  readonly #responses: Array<MessageStreamResult | Error>;

  public constructor(responses: Array<MessageStreamResult | Error>) {
    super();
    this.#responses = [...responses];
  }

  public async process(_stream: IMessageStream): Promise<MessageStreamResult> {
    this.calls++;
    const next = this.#responses.shift();
    if (next == null) {
      throw new Error('FakeProcessor: no more scripted responses');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}

class FakeClock extends Clock {
  #instant: Instant;

  public constructor(start: Instant) {
    super();
    this.#instant = start;
  }

  public instant(): Instant {
    return this.#instant;
  }

  public millis(): number {
    return this.#instant.toEpochMilli();
  }

  public zone(): ZoneId {
    return ZoneOffset.UTC;
  }

  public withZone(_zone: ZoneId): Clock {
    return this;
  }

  public advance(ms: number): void {
    this.#instant = this.#instant.plusMillis(ms);
  }

  public equals(_other: unknown): boolean {
    return false;
  }
}

class SpyListener implements AccountLimitListener {
  public retryingCount = 0;
  public stoppedCount = 0;

  public retrying(): void {
    this.retryingCount++;
  }

  public stopped(): void {
    this.stoppedCount++;
  }
}

class SpyWakeLock extends IWakeLock {
  public acquired = 0;
  public released = 0;

  public acquire(): WakeLockHandle {
    this.acquired++;
    return {
      release: () => {
        this.released++;
      },
    };
  }
}

class SpyInterruption extends StreamInterruptListener {
  public count = 0;

  public reconnecting(): void {
    this.count++;
  }
}

class FakeSleep {
  public readonly calls: number[] = [];
  readonly #onCall: ((ms: number) => void) | undefined;

  public constructor(onCall?: (ms: number) => void) {
    this.#onCall = onCall;
  }

  public readonly fn = async (ms: number, _signal: AbortSignal): Promise<void> => {
    this.calls.push(ms);
    this.#onCall?.(ms);
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<MessageStreamResult> = {}): MessageStreamResult {
  return {
    blocks: [{ type: 'text', text: 'ok' }],
    stopReason: 'end_turn',
    contextManagementOccurred: false,
    usage: { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
    ...overrides,
  };
}

function makeDurableConfig(): DurableConfig {
  return { model: 'claude-opus-4-5' as DurableConfig['model'], maxTokens: 1024, tools: [] };
}

function makeConvWithUser(text: string): Conversation {
  const conv = new Conversation();
  conv.push({ role: 'user', content: text });
  return conv;
}

function accountLimitError(): HttpError {
  return new HttpError(429, 90_000, undefined, new Headers());
}

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

/**
 * Builds a TurnRunner through a real core-di-lite container, registering the
 * test fakes against the injection contracts. Mirrors the old positional
 * constructor signature so the scripted scenarios read unchanged; the bare
 * sleep/random values are wrapped in their provider abstractions, and the clock
 * is registered directly as js-joda's `Clock`.
 */
function buildTurnRunner(streamer: IMessageStreamer, processor: IStreamProcessor, logger?: ILogger, listener?: AccountLimitListener, sleep?: (ms: number, signal: AbortSignal) => Promise<void>, random?: () => number, clock?: Clock, wakeLock?: IWakeLock, interruption?: StreamInterruptListener): TurnRunner {
  const services = createServiceCollection();
  services.register(IMessageStreamer).to(IMessageStreamer, () => streamer);
  services.register(IStreamProcessor).to(IStreamProcessor, () => processor);
  services.register(ILogger).to(ILogger, () => logger ?? new NoopLogger());
  services.register(AccountLimitListener).to(AccountLimitListener, () => listener ?? new SpyListener());
  services.register(ISleepProvider).to(ISleepProvider, () => ({ sleep: sleep ?? (async () => {}) }));
  services.register(IRandomProvider).to(IRandomProvider, () => ({ next: random ?? (() => Math.random()) }));
  services.register(Clock).to(Clock, () => clock ?? Clock.fixed(Instant.ofEpochMilli(0), ZoneOffset.UTC));
  services.register(IWakeLock).to(IWakeLock, () => wakeLock ?? new SpyWakeLock());
  services.register(StreamInterruptListener).to(StreamInterruptListener, () => interruption ?? new SpyInterruption());
  services.register(TurnRunner).to(TurnRunner);
  return services.buildProvider().resolve(TurnRunner);
}

// ---------------------------------------------------------------------------
// Single-turn correctness
// ---------------------------------------------------------------------------

describe('TurnRunner — single turn correctness', () => {
  it('pushes the assembled assistant message to the conversation', async () => {
    const streamer = new FakeStreamer();
    const processor = new FakeProcessor([makeResult({ blocks: [{ type: 'text', text: 'hello' }] })]);
    const runner = buildTurnRunner(streamer, processor);
    const conv = makeConvWithUser('hi');

    await runner.run(conv, makeDurableConfig(), { abortSignal: new AbortController().signal });

    const actual = conv.messages.at(-1)?.content;
    expect(actual).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('does not push an assistant message when the result has no blocks', async () => {
    const streamer = new FakeStreamer();
    const processor = new FakeProcessor([makeResult({ blocks: [] })]);
    const runner = buildTurnRunner(streamer, processor);
    const conv = makeConvWithUser('hi');
    const before = conv.messages.length;

    await runner.run(conv, makeDurableConfig(), { abortSignal: new AbortController().signal });

    const actual = conv.messages.length;
    expect(actual).toBe(before);
  });

  it('injects the per-turn systemReminder into the request body', async () => {
    const streamer = new FakeStreamer();
    const processor = new FakeProcessor([makeResult()]);
    const runner = buildTurnRunner(streamer, processor);
    const conv = makeConvWithUser('hi');

    await runner.run(conv, makeDurableConfig(), { abortSignal: new AbortController().signal, systemReminder: 'stay focused' });

    const lastMsg = streamer.calls[0]?.body.messages.at(-1);
    const content = Array.isArray(lastMsg?.content) ? lastMsg.content : [];
    const actual = content.some((b) => typeof b === 'object' && 'text' in b && typeof b.text === 'string' && b.text.includes('<system-reminder>'));
    expect(actual).toBe(true);
  });

  it('passes the per-turn abort signal to the streamer request options', async () => {
    const streamer = new FakeStreamer();
    const processor = new FakeProcessor([makeResult()]);
    const runner = buildTurnRunner(streamer, processor);
    const conv = makeConvWithUser('hi');
    const abort = new AbortController();

    await runner.run(conv, makeDurableConfig(), { abortSignal: abort.signal });

    const actual = streamer.calls[0]?.options.signal;
    expect(actual).toBe(abort.signal);
  });
});

// ---------------------------------------------------------------------------
// Account-limit retry: cap, give-up budget, ESC, X/Y
// ---------------------------------------------------------------------------

describe('TurnRunner — account-limit retry', () => {
  it('caps the account-limit wait at RETRY_AFTER_CAP_MS, not the header value', async () => {
    const clock = new FakeClock(Instant.ofEpochMilli(0));
    const sleep = new FakeSleep((ms) => clock.advance(ms));
    const streamer = new FakeStreamer();
    const processor = new FakeProcessor([accountLimitError(), makeResult()]);
    const runner = buildTurnRunner(streamer, processor, undefined, new SpyListener(), sleep.fn, () => 0, clock);

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal });

    const actual = sleep.calls[0];
    expect(actual).toBe(RETRY_AFTER_CAP_MS);
  });

  it('raises retrying once per capped retry before success', async () => {
    const clock = new FakeClock(Instant.ofEpochMilli(0));
    const sleep = new FakeSleep((ms) => clock.advance(ms));
    const listener = new SpyListener();
    const processor = new FakeProcessor([accountLimitError(), accountLimitError(), accountLimitError(), makeResult()]);
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, listener, sleep.fn, () => 0, clock);

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal });

    const actual = listener.retryingCount;
    expect(actual).toBe(3);
  });

  it('throws AccountLimitStoppedError once the give-up budget elapses', async () => {
    const clock = new FakeClock(Instant.ofEpochMilli(0));
    const sleep = new FakeSleep((ms) => clock.advance(ms));
    const processor = new FakeProcessor(Array.from({ length: 20 }, () => accountLimitError()));
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, new SpyListener(), sleep.fn, () => 0, clock);

    const actual = runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal });

    await expect(actual).rejects.toBeInstanceOf(AccountLimitStoppedError);
  });

  it('raises stopped exactly once at give-up', async () => {
    const clock = new FakeClock(Instant.ofEpochMilli(0));
    const sleep = new FakeSleep((ms) => clock.advance(ms));
    const listener = new SpyListener();
    const processor = new FakeProcessor(Array.from({ length: 20 }, () => accountLimitError()));
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, listener, sleep.fn, () => 0, clock);

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal }).catch(() => {});

    const actual = listener.stoppedCount;
    expect(actual).toBe(1);
  });

  it('raises retrying for each minute of the budget before giving up', async () => {
    const clock = new FakeClock(Instant.ofEpochMilli(0));
    const sleep = new FakeSleep((ms) => clock.advance(ms));
    const listener = new SpyListener();
    const processor = new FakeProcessor(Array.from({ length: 20 }, () => accountLimitError()));
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, listener, sleep.fn, () => 0, clock);

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal }).catch(() => {});

    const expected = ACCOUNT_LIMIT_BUDGET_MS / RETRY_AFTER_CAP_MS;
    const actual = listener.retryingCount;
    expect(actual).toBe(expected);
  });

  it('does not wait after the give-up decision (never wait-then-quit)', async () => {
    const clock = new FakeClock(Instant.ofEpochMilli(0));
    const sleep = new FakeSleep((ms) => clock.advance(ms));
    const processor = new FakeProcessor(Array.from({ length: 20 }, () => accountLimitError()));
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, new SpyListener(), sleep.fn, () => 0, clock);

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal }).catch(() => {});

    const expected = ACCOUNT_LIMIT_BUDGET_MS / RETRY_AFTER_CAP_MS;
    const actual = sleep.calls.length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ESC during an account-limit wait: cancel, not give-up
// ---------------------------------------------------------------------------

describe('TurnRunner — ESC during account-limit wait', () => {
  it('throws the abort reason when ESC fires during the wait', async () => {
    const abort = new AbortController();
    const reason = new Error('cancelled');
    const sleep = new FakeSleep(() => abort.abort(reason));
    const processor = new FakeProcessor([accountLimitError(), makeResult()]);
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, new SpyListener(), sleep.fn, () => 0, new FakeClock(Instant.ofEpochMilli(0)));

    const actual = runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: abort.signal });

    await expect(actual).rejects.toBe(reason);
  });

  it('does not raise stopped when ESC cancels the wait', async () => {
    const abort = new AbortController();
    const sleep = new FakeSleep(() => abort.abort(new Error('cancelled')));
    const listener = new SpyListener();
    const processor = new FakeProcessor([accountLimitError(), makeResult()]);
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, listener, sleep.fn, () => 0, new FakeClock(Instant.ofEpochMilli(0)));

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: abort.signal }).catch(() => {});

    const actual = listener.stoppedCount;
    expect(actual).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Transient retry: existing backoff, independent of the account-limit path
// ---------------------------------------------------------------------------

describe('TurnRunner — transient retry', () => {
  it('retries a transient error with the exponential backoff schedule', async () => {
    const sleep = new FakeSleep();
    const processor = new FakeProcessor([new ConnectionError('boom'), makeResult()]);
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, new SpyListener(), sleep.fn, () => 0);

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal });

    const actual = sleep.calls[0];
    expect(actual).toBe(BASE_DELAY_MS);
  });

  it('throws a non-retryable error immediately without sleeping', async () => {
    const sleep = new FakeSleep();
    const processor = new FakeProcessor([new HttpError(400, undefined, undefined, new Headers())]);
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, new SpyListener(), sleep.fn, () => 0);

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal }).catch(() => {});

    const actual = sleep.calls.length;
    expect(actual).toBe(0);
  });

  it('bounds transient retries at MAX_RETRIES', async () => {
    const sleep = new FakeSleep();
    const processor = new FakeProcessor(Array.from({ length: MAX_RETRIES + 1 }, () => new ConnectionError('boom')));
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, new SpyListener(), sleep.fn, () => 0);

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal }).catch(() => {});

    const actual = sleep.calls.length;
    expect(actual).toBe(MAX_RETRIES);
  });

  it('keeps the transient backoff budget independent of account-limit retries', async () => {
    const clock = new FakeClock(Instant.ofEpochMilli(0));
    const sleep = new FakeSleep((ms) => clock.advance(ms));
    const processor = new FakeProcessor([accountLimitError(), new ConnectionError('boom'), makeResult()]);
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, new SpyListener(), sleep.fn, () => 0, clock);

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal });

    const expected = [RETRY_AFTER_CAP_MS, BASE_DELAY_MS];
    const actual = sleep.calls;
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Stream-interrupt retry: short fixed-delay strategy, own counter, reconnect signal
// ---------------------------------------------------------------------------

describe('TurnRunner — stream-interrupt retry', () => {
  it('retries a stream interruption with the fixed delay', async () => {
    const sleep = new FakeSleep();
    const processor = new FakeProcessor([new StreamInterruptedError(), makeResult()]);
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, undefined, sleep.fn, () => 0);

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal });

    const actual = sleep.calls[0];
    expect(actual).toBe(STREAM_INTERRUPT_DELAY_MS);
  });

  it('bounds stream-interrupt retries at STREAM_INTERRUPT_MAX_RETRIES', async () => {
    const sleep = new FakeSleep();
    const processor = new FakeProcessor(Array.from({ length: STREAM_INTERRUPT_MAX_RETRIES + 1 }, () => new StreamInterruptedError()));
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, undefined, sleep.fn, () => 0);

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal }).catch(() => {});

    const actual = sleep.calls.length;
    expect(actual).toBe(STREAM_INTERRUPT_MAX_RETRIES);
  });

  it('rethrows the interruption once the retry ceiling is exceeded', async () => {
    const sleep = new FakeSleep();
    const processor = new FakeProcessor(Array.from({ length: STREAM_INTERRUPT_MAX_RETRIES + 1 }, () => new StreamInterruptedError()));
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, undefined, sleep.fn, () => 0);

    const actual = runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal });

    await expect(actual).rejects.toBeInstanceOf(StreamInterruptedError);
  });

  it('raises reconnecting once per stream-interrupt retry', async () => {
    const sleep = new FakeSleep();
    const interruption = new SpyInterruption();
    const processor = new FakeProcessor([new StreamInterruptedError(), new StreamInterruptedError(), makeResult()]);
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, undefined, sleep.fn, () => 0, undefined, undefined, interruption);

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal });

    const actual = interruption.count;
    expect(actual).toBe(2);
  });

  it('keeps the stream-interrupt budget independent of transient retries', async () => {
    const sleep = new FakeSleep();
    const processor = new FakeProcessor([new StreamInterruptedError(), new ConnectionError('boom'), makeResult()]);
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, undefined, sleep.fn, () => 0);

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal });

    const expected = [STREAM_INTERRUPT_DELAY_MS, BASE_DELAY_MS];
    const actual = sleep.calls;
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Wake lock: held across the request loop, released once on success and on throw
// ---------------------------------------------------------------------------

describe('TurnRunner — wake lock', () => {
  it('acquires the wake lock once for the turn', async () => {
    const wakeLock = new SpyWakeLock();
    const processor = new FakeProcessor([makeResult()]);
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, undefined, undefined, () => 0, undefined, wakeLock);

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal });

    const actual = wakeLock.acquired;
    expect(actual).toBe(1);
  });

  it('releases the wake lock once when the turn succeeds', async () => {
    const wakeLock = new SpyWakeLock();
    const processor = new FakeProcessor([makeResult()]);
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, undefined, undefined, () => 0, undefined, wakeLock);

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal });

    const actual = wakeLock.released;
    expect(actual).toBe(1);
  });

  it('releases the wake lock when the turn throws', async () => {
    const wakeLock = new SpyWakeLock();
    const processor = new FakeProcessor([new HttpError(400, undefined, undefined, new Headers())]);
    const runner = buildTurnRunner(new FakeStreamer(), processor, undefined, undefined, undefined, () => 0, undefined, wakeLock);

    await runner.run(makeConvWithUser('hi'), makeDurableConfig(), { abortSignal: new AbortController().signal }).catch(() => {});

    const actual = wakeLock.released;
    expect(actual).toBe(1);
  });
});
