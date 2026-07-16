import { Clock, DateTimeException, DateTimeFormatter, type Instant, LocalDate, Period, YearMonth, type ZoneId, ZoneOffset } from '@js-joda/core';

export type RelativeUnit = 'd' | 'w' | 'm' | 'y';

/** Which end of a range a bound sits on. `since` snaps an absolute period to its start, `until` to its end. */
export type TimeBoundEdge = 'since' | 'until';

/**
 * A `since` / `until` bound parsed into the two shapes the grammar allows. `relative` is a span back from now — a
 * count and a calendar unit (`7d`, `2w`, `3m`, `1y`); note `m` is month, not minutes, and there is no hour unit.
 * `absolute` is a local calendar date carried at year, month, or day granularity, the discriminant saying which.
 */
export type ParsedTimeBound = { kind: 'relative'; amount: number; unit: RelativeUnit } | ({ kind: 'absolute' } & AbsoluteDate);

type AbsoluteDate = { granularity: 'year'; year: number } | { granularity: 'month'; year: number; month: number } | { granularity: 'day'; year: number; month: number; day: number };

const RELATIVE = /^(\d+)([dwmy])$/;
const ABSOLUTE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

// Millisecond ISO with exactly three fractional digits and a Z suffix. The stored `timestamp`s are compared
// lexicographically, so a resolved bound must carry the same shape or an equal instant would sort as unequal.
const ISO_MILLIS = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");

/**
 * Parse a time-bound string into its shape, or `null` if it is not a valid bound. Absolute forms are validated as
 * real calendar dates through js-joda — a month outside 1–12 (`2026-13`) or a day that does not exist (`2026-06-31`)
 * is rejected, not merely the wrong shape. This is the single validity oracle: the schema refines on it and
 * `resolveTimeBound` consumes it, so the accepted grammar lives in one place.
 */
export function parseTimeBound(value: string): ParsedTimeBound | null {
  const relative = RELATIVE.exec(value);
  if (relative !== null) {
    return { kind: 'relative', amount: Number(relative[1]), unit: relative[2] as RelativeUnit };
  }
  const absolute = ABSOLUTE.exec(value);
  if (absolute === null) {
    return null;
  }
  const year = Number(absolute[1]);
  if (absolute[2] === undefined) {
    return { kind: 'absolute', granularity: 'year', year };
  }
  const month = Number(absolute[2]);
  if (absolute[3] === undefined) {
    return isRealDate(() => YearMonth.of(year, month)) ? { kind: 'absolute', granularity: 'month', year, month } : null;
  }
  const day = Number(absolute[3]);
  return isRealDate(() => LocalDate.of(year, month, day)) ? { kind: 'absolute', granularity: 'day', year, month, day } : null;
}

/**
 * Resolve a parsed bound to the ISO instant the stored `timestamp`s are compared against. The `clock` carries both
 * the reading of now and the user's timezone, injected by the caller so resolution is deterministic and testable —
 * nothing here reads the ambient host. A relative bound is `now` minus the span in calendar units at the clock's
 * zone. An absolute bound is a local calendar period in that zone: `since` resolves to the first instant of the
 * period, `until` to its last millisecond, each converted to its UTC instant — so `2026-06-20` at +10:00 lands on
 * `2026-06-19T14:00:00.000Z` at the lower edge, and the whole of that local day is covered inclusively at the upper.
 */
export function resolveTimeBound(bound: ParsedTimeBound, edge: TimeBoundEdge, clock: Clock): string {
  const zone = clock.zone();
  if (bound.kind === 'relative') {
    return toIsoMillis(clock.instant().atZone(zone).minus(periodOf(bound.amount, bound.unit)).toInstant());
  }
  return toIsoMillis(resolveAbsolute(bound, edge, zone));
}

function periodOf(amount: number, unit: RelativeUnit): Period {
  switch (unit) {
    case 'd':
      return Period.ofDays(amount);
    case 'w':
      return Period.ofWeeks(amount);
    case 'm':
      return Period.ofMonths(amount);
    case 'y':
      return Period.ofYears(amount);
  }
}

function resolveAbsolute(bound: AbsoluteDate, edge: TimeBoundEdge, zone: ZoneId): Instant {
  if (edge === 'since') {
    return startOfPeriod(bound).atStartOfDay(zone).toInstant();
  }
  // `until` is inclusive to the granularity, so it is the last millisecond of the period: the first instant of the
  // next period minus one millisecond.
  return startOfNextPeriod(bound).atStartOfDay(zone).toInstant().minusMillis(1);
}

function startOfPeriod(bound: AbsoluteDate): LocalDate {
  switch (bound.granularity) {
    case 'year':
      return LocalDate.of(bound.year, 1, 1);
    case 'month':
      return LocalDate.of(bound.year, bound.month, 1);
    case 'day':
      return LocalDate.of(bound.year, bound.month, bound.day);
  }
}

function startOfNextPeriod(bound: AbsoluteDate): LocalDate {
  switch (bound.granularity) {
    case 'year':
      return LocalDate.of(bound.year + 1, 1, 1);
    case 'month':
      return YearMonth.of(bound.year, bound.month).plusMonths(1).atDay(1);
    case 'day':
      return LocalDate.of(bound.year, bound.month, bound.day).plusDays(1);
  }
}

function toIsoMillis(instant: Instant): string {
  return instant.atZone(ZoneOffset.UTC).format(ISO_MILLIS);
}

// js-joda throws DateTimeException when a field is out of range (month 13) or the day does not exist in the month
// (31 June). Anything else is a real fault and propagates.
function isRealDate(build: () => unknown): boolean {
  try {
    build();
    return true;
  } catch (error) {
    if (error instanceof DateTimeException) {
      return false;
    }
    throw error;
  }
}
