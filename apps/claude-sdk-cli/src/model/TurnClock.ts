import { Clock, Duration } from '@js-joda/core';
import { dependsOn } from '@shellicar/core-di-lite';
import { type ClockSnapshot, ITurnClock } from './ITurnClock.js';

/**
 * Turn-time state machine. Three tracked roles, each accumulating only between
 * its own start and its own stop; the gap between a stop and the next start is
 * untracked Unknown, so the totals need not sum to elapsed. Attribution
 * resolves at the stop: `claudeStop(kept)` charges `claude` only on a 2xx.
 *
 * Fresh at 0 every process; nothing persists across sessions.
 *
 * Scaffold stub: shape only. The Builder implements the accumulation.
 */
export class TurnClock extends ITurnClock {
  @dependsOn(Clock) private readonly clock!: Clock;

  public userStart(): void {}

  public userStop(): void {}

  public toolsStart(): void {}

  public toolsStop(): void {}

  public claudeStart(): void {}

  public claudeStop(_kept: boolean): void {}

  public snapshot(): ClockSnapshot {
    return { user: Duration.ZERO, tools: Duration.ZERO, claude: Duration.ZERO, active: null };
  }
}
