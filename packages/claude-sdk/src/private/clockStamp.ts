import { type Clock, DateTimeFormatter, ZonedDateTime } from '@js-joda/core';
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
export function formatClockStamp(clock: Clock): string {
  return ZonedDateTime.now(clock).format(formatter);
}

// Matches the wrapper shape buildReminderBlocks produces around a formatClockStamp() value,
// independent of the actual date/time it carries. Used to detect a stamp already prepended to
// the tip message, so a retry that re-presents the same tip (see TurnRunner.run) does not stack
// a second one on top of it.
const CLOCK_STAMP_BLOCK_PATTERN = /^<system-reminder>\n[A-Za-z]+, \d{1,2} [A-Za-z]+ \d{4} at \d{2}:\d{2}:\d{2} .+ \([+-]\d{2}:\d{2}\)\n<\/system-reminder>\n\n?$/;

/** True when `text` is a clock-stamp reminder block, regardless of which moment it stamps. */
export function isClockStampBlock(text: string): boolean {
  return CLOCK_STAMP_BLOCK_PATTERN.test(text);
}
