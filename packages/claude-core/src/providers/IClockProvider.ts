import type { Clock } from '@js-joda/core';

/**
 * The injectable system clock. Exposes the js-joda Clock so consumers can take
 * instants (zone-independent) and zoned stamps. Replaces the
 * `clock = Clock.systemDefaultZone()` / `Clock.systemUTC()` default-parameter idiom.
 */
export abstract class IClockProvider {
  public abstract get clock(): Clock;
}
