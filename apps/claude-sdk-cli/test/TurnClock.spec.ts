import { Clock, Instant, type ZoneId, ZoneOffset } from '@js-joda/core';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { ITurnClock } from '../src/model/ITurnClock.js';
import { TurnClock } from '../src/model/TurnClock.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

// A hand-advanced Clock: totals must derive from these timestamps, never from a
// per-tick counter, so the tests move the clock explicitly and read the result.
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

// Resolves the abstract through a container — the DI convention binds
// consumers to ITurnClock, and TurnClock takes its Clock via @dependsOn.
function build(clock: Clock): ITurnClock {
  const services = createServiceCollection();
  services.register(Clock).to(Clock, () => clock);
  services.register(ITurnClock).to(TurnClock);
  return services.buildProvider().resolve(ITurnClock);
}

// ---------------------------------------------------------------------------
// Fresh start
// ---------------------------------------------------------------------------

describe('TurnClock — fresh start', () => {
  it('user total starts at 0', () => {
    const expected = 0;
    const actual = build(new FakeClock(Instant.ofEpochMilli(0))).snapshot().user.toMillis();
    expect(actual).toBe(expected);
  });

  it('tools total starts at 0', () => {
    const expected = 0;
    const actual = build(new FakeClock(Instant.ofEpochMilli(0))).snapshot().tools.toMillis();
    expect(actual).toBe(expected);
  });

  it('claude total starts at 0', () => {
    const expected = 0;
    const actual = build(new FakeClock(Instant.ofEpochMilli(0))).snapshot().claude.toMillis();
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// A role accumulates only between its own start and its own stop
// ---------------------------------------------------------------------------

describe('TurnClock — a role accumulates only between its own start and stop', () => {
  it('excludes time before the start and after the stop from the user total', () => {
    const clock = new FakeClock(Instant.ofEpochMilli(0));
    const turnClock = build(clock);
    clock.advance(3000); // before start — must not count
    turnClock.userStart();
    clock.advance(5000);
    turnClock.userStop();
    clock.advance(4000); // after stop — must not count
    const expected = 5000;
    const actual = turnClock.snapshot().user.toMillis();
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Tracked totals need not sum to elapsed
// ---------------------------------------------------------------------------

describe('TurnClock — tracked totals need not sum to elapsed', () => {
  it('leaves the gap between a stop and the next start untracked', () => {
    const clock = new FakeClock(Instant.ofEpochMilli(0));
    const turnClock = build(clock);
    turnClock.userStart();
    clock.advance(2000);
    turnClock.userStop();
    clock.advance(3000); // gap — Unknown, tracked by nobody
    turnClock.claudeStart();
    clock.advance(4000);
    turnClock.claudeStop(true);
    const snap = turnClock.snapshot();
    const expected = 6000; // 2000 user + 4000 claude, while the clock advanced 9000
    const actual = snap.user.plus(snap.tools).plus(snap.claude).toMillis();
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// claude 2xx resolution
// ---------------------------------------------------------------------------

describe('TurnClock — claude resolves at the stop by outcome', () => {
  it('keeps the in-flight elapsed on a 2xx settle', () => {
    const clock = new FakeClock(Instant.ofEpochMilli(0));
    const turnClock = build(clock);
    turnClock.claudeStart();
    clock.advance(4000);
    turnClock.claudeStop(true);
    const expected = 4000;
    const actual = turnClock.snapshot().claude.toMillis();
    expect(actual).toBe(expected);
  });

  it('discards the in-flight elapsed on a non-2xx settle', () => {
    const clock = new FakeClock(Instant.ofEpochMilli(0));
    const turnClock = build(clock);
    turnClock.claudeStart();
    clock.advance(4000);
    turnClock.claudeStop(false);
    const expected = 0;
    const actual = turnClock.snapshot().claude.toMillis();
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// tools is one bracket across a multi-tool turn
// ---------------------------------------------------------------------------

describe('TurnClock — tools is one bracket across a multi-tool turn', () => {
  it('accumulates first-tool-start to last-tool-stop including inter-tool gaps', () => {
    const clock = new FakeClock(Instant.ofEpochMilli(0));
    const turnClock = build(clock);
    turnClock.toolsStart();
    clock.advance(2000); // tool 1
    clock.advance(1000); // gap between tools — inside the bracket
    clock.advance(2000); // tool 2
    turnClock.toolsStop();
    const expected = 5000;
    const actual = turnClock.snapshot().tools.toMillis();
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Totals derive from the injected clock's timestamps
// ---------------------------------------------------------------------------

describe('TurnClock — totals derive from the injected clock', () => {
  it('reflects the injected clock advance in the user total', () => {
    const clock = new FakeClock(Instant.ofEpochMilli(0));
    const turnClock = build(clock);
    turnClock.userStart();
    clock.advance(7000);
    turnClock.userStop();
    const expected = 7000;
    const actual = turnClock.snapshot().user.toMillis();
    expect(actual).toBe(expected);
  });
});
