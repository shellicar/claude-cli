import { Clock, Duration, type Instant } from '@js-joda/core';
import { dependsOn } from '@shellicar/core-di-lite';
import { type ClockRole, type ClockSnapshot, ITurnClock } from './ITurnClock.js';

/**
 * Turn-time state machine. Three tracked roles, each accumulating only between
 * its own start and its own stop; the gap between a stop and the next start is
 * untracked Unknown, so the totals need not sum to elapsed. Attribution
 * resolves at the stop: `claudeStop(kept)` charges `claude` only on a 2xx.
 *
 * Assumes well-ordered edges — one role active at a time, each stop closing the
 * bracket its own start opened. The six emission points guarantee that; a stop
 * whose role is not the active one is a no-op, which is how deferred attribution
 * and the negative space between roles are expressed.
 *
 * Fresh at 0 every process; nothing persists across sessions.
 */
export class TurnClock extends ITurnClock {
  @dependsOn(Clock) private readonly clock!: Clock;
  #totals: Record<ClockRole, Duration> = {
    user: Duration.ZERO,
    tools: Duration.ZERO,
    claude: Duration.ZERO,
  };
  #active: ClockRole | null = null;
  #since: Instant | null = null;

  #start(role: ClockRole): void {
    this.#active = role;
    this.#since = this.clock.instant();
  }

  #stop(role: ClockRole, keep: boolean): void {
    if (this.#active !== role || this.#since === null) {
      return;
    }
    if (keep) {
      this.#totals[role] = this.#totals[role].plus(Duration.between(this.#since, this.clock.instant()));
    }
    this.#active = null;
    this.#since = null;
  }

  public userStart(): void {
    this.#start('user');
  }
  public userStop(): void {
    this.#stop('user', true);
  }
  public toolsStart(): void {
    this.#start('tools');
  }
  public toolsStop(): void {
    this.#stop('tools', true);
  }
  public claudeStart(): void {
    this.#start('claude');
  }
  public claudeStop(kept: boolean): void {
    this.#stop('claude', kept);
  }

  /** Committed totals with the active role's live segment folded in. Reads the
   * injected clock, so the active total advances between edges. */
  public snapshot(): ClockSnapshot {
    const now = this.clock.instant();
    const live = (role: ClockRole): Duration => (this.#active === role && this.#since !== null ? this.#totals[role].plus(Duration.between(this.#since, now)) : this.#totals[role]);
    return { user: live('user'), tools: live('tools'), claude: live('claude'), active: this.#active };
  }
}
