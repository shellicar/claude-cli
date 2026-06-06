import { Clock, DateTimeFormatter, ZonedDateTime } from '@js-joda/core';
import { Locale } from '@js-joda/locale_en';
import '@js-joda/timezone';

const formatter = DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy 'at' HH:mm:ss VV (xxx)").withLocale(Locale.ENGLISH);

/**
 * Returns the current date/time formatted as a human-readable stamp.
 *
 * Accepts an optional `Clock` for deterministic tests. Defaults to
 * `Clock.systemDefaultZone()` (system clock, system timezone) in production.
 *
 * Example output: `Friday, 29 May 2026 at 14:32:15 Australia/Melbourne (+10:00)`
 */
export function formatClockStamp(clock: Clock = Clock.systemDefaultZone()): string {
  return ZonedDateTime.now(clock).format(formatter);
}
