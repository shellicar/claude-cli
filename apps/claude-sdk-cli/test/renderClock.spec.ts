import { Clock, Instant, type ZoneId, ZoneOffset } from '@js-joda/core';
import { BOLD_WHITE, RESET } from '@shellicar/claude-core/ansi';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { ITurnClock } from '../src/model/ITurnClock.js';
import { TurnClock } from '../src/model/TurnClock.js';
import { renderClock } from '../src/view/renderStatus.js';

// The role emojis renderClock prefixes each total with. Named here so the
// assertions read against a role, not a raw code point.
const USER_EMOJI = '\u{1F464}';
const TOOLS_EMOJI = '\u{1F527}';
const CLAUDE_EMOJI = '\u{1F916}';

// ---------------------------------------------------------------------------
// Fakes — the same hand-advanced clock the core spec uses, so the rendered
// figures derive from injected timestamps rather than a live session.
// ---------------------------------------------------------------------------

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

// Resolves the abstract through a container, binding the injected Clock — the
// same seam the core tests drive.
function build(clock: Clock): ITurnClock {
  const services = createServiceCollection();
  services.register(Clock).to(Clock, () => clock);
  services.register(ITurnClock).to(TurnClock);
  return services.buildProvider().resolve(ITurnClock);
}

// ---------------------------------------------------------------------------
// All three totals appear
// ---------------------------------------------------------------------------

describe('renderClock — all three totals appear', () => {
  it('renders the user total', () => {
    const expected = `${USER_EMOJI} 0s`;
    const actual = renderClock(build(new FakeClock(Instant.ofEpochMilli(0))).snapshot());
    expect(actual).toContain(expected);
  });

  it('renders the tools total', () => {
    const expected = `${TOOLS_EMOJI} 0s`;
    const actual = renderClock(build(new FakeClock(Instant.ofEpochMilli(0))).snapshot());
    expect(actual).toContain(expected);
  });

  it('renders the claude total', () => {
    const expected = `${CLAUDE_EMOJI} 0s`;
    const actual = renderClock(build(new FakeClock(Instant.ofEpochMilli(0))).snapshot());
    expect(actual).toContain(expected);
  });
});

// ---------------------------------------------------------------------------
// Figures reflect the clock state
// ---------------------------------------------------------------------------

describe('renderClock — figures reflect the clock state', () => {
  it('shows zeros for a fresh clock', () => {
    const expected = ` ${USER_EMOJI} 0s   ${TOOLS_EMOJI} 0s   ${CLAUDE_EMOJI} 0s`;
    const actual = renderClock(build(new FakeClock(Instant.ofEpochMilli(0))).snapshot());
    expect(actual).toBe(expected);
  });

  it('shows the elapsed time of a role that has run', () => {
    const clock = new FakeClock(Instant.ofEpochMilli(0));
    const turnClock = build(clock);
    turnClock.userStart();
    clock.advance(5000);
    turnClock.userStop();
    const expected = `${USER_EMOJI} 5s`;
    const actual = renderClock(turnClock.snapshot());
    expect(actual).toContain(expected);
  });
});

// ---------------------------------------------------------------------------
// The active role is distinguished
// ---------------------------------------------------------------------------

describe('renderClock — the active role is distinguished', () => {
  it('wraps the active role segment in bold', () => {
    const clock = new FakeClock(Instant.ofEpochMilli(0));
    const turnClock = build(clock);
    turnClock.userStart();
    clock.advance(5000);
    const expected = `${BOLD_WHITE}${USER_EMOJI} 5s${RESET}`;
    const actual = renderClock(turnClock.snapshot());
    expect(actual).toContain(expected);
  });

  it('leaves an inactive role segment unbolded', () => {
    const clock = new FakeClock(Instant.ofEpochMilli(0));
    const turnClock = build(clock);
    turnClock.userStart();
    clock.advance(5000);
    const expected = false;
    const actual = renderClock(turnClock.snapshot()).includes(`${BOLD_WHITE}${CLAUDE_EMOJI}`);
    expect(actual).toBe(expected);
  });
});
