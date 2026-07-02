import type { Duration } from '@js-joda/core';

export type ClockRole = 'user' | 'tools' | 'claude';

/** The three tracked totals plus which role (if any) is currently running.
 * Values fold the active role's in-progress segment so the display ticks. */
export type ClockSnapshot = {
  user: Duration;
  tools: Duration;
  claude: Duration;
  active: ClockRole | null;
};

/** Turn-time state machine. Six edges (a start and a stop per role) plus a
 * live-folding read. The abstract is the injection identifier; consumers depend
 * on it, never on the concrete. */
export abstract class ITurnClock {
  public abstract userStart(): void;
  public abstract userStop(): void;
  public abstract toolsStart(): void;
  public abstract toolsStop(): void;
  public abstract claudeStart(): void;
  public abstract claudeStop(kept: boolean): void;
  public abstract snapshot(): ClockSnapshot;
}
