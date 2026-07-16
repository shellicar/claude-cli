import { Clock, Instant, ZoneOffset } from '@js-joda/core';
import { describe, expect, it } from 'vitest';
import { type ParsedTimeBound, parseTimeBound, resolveTimeBound } from '../src/History/timeBound';

// Each resolution test injects a fixed Clock (a pinned instant plus a fixed-offset zone), so the expected UTC instant
// is deterministic and the suite proves the behaviour across offsets — positive, negative, half-hour, and UTC —
// without ever reading the host clock or zone.

describe('parseTimeBound — relative spans', () => {
  it('reads a day span', () => {
    const expected: ParsedTimeBound = { kind: 'relative', amount: 7, unit: 'd' };
    const actual = parseTimeBound('7d');
    expect(actual).toEqual(expected);
  });

  it('reads m as a month span, not minutes', () => {
    const expected: ParsedTimeBound = { kind: 'relative', amount: 3, unit: 'm' };
    const actual = parseTimeBound('3m');
    expect(actual).toEqual(expected);
  });

  it('reads a year span', () => {
    const expected: ParsedTimeBound = { kind: 'relative', amount: 1, unit: 'y' };
    const actual = parseTimeBound('1y');
    expect(actual).toEqual(expected);
  });

  it('rejects an hour span — there is no hour unit', () => {
    const actual = parseTimeBound('3h');
    expect(actual).toBeNull();
  });
});

describe('parseTimeBound — absolute dates', () => {
  it('reads a year', () => {
    const expected: ParsedTimeBound = { kind: 'absolute', granularity: 'year', year: 2026 };
    const actual = parseTimeBound('2026');
    expect(actual).toEqual(expected);
  });

  it('reads a year-month', () => {
    const expected: ParsedTimeBound = { kind: 'absolute', granularity: 'month', year: 2026, month: 6 };
    const actual = parseTimeBound('2026-06');
    expect(actual).toEqual(expected);
  });

  it('reads a year-month-day', () => {
    const expected: ParsedTimeBound = { kind: 'absolute', granularity: 'day', year: 2026, month: 6, day: 20 };
    const actual = parseTimeBound('2026-06-20');
    expect(actual).toEqual(expected);
  });

  it('rejects a month outside 1–12', () => {
    const actual = parseTimeBound('2026-13');
    expect(actual).toBeNull();
  });

  it('rejects a day that does not exist in the month', () => {
    const actual = parseTimeBound('2026-06-31');
    expect(actual).toBeNull();
  });
});

describe('parseTimeBound — malformed', () => {
  it('rejects a garbled string', () => {
    const actual = parseTimeBound('banana-o-clock');
    expect(actual).toBeNull();
  });

  it('rejects an empty string', () => {
    const actual = parseTimeBound('');
    expect(actual).toBeNull();
  });
});

const UTC = ZoneOffset.UTC;
const AEST = ZoneOffset.ofHours(10);
const EST = ZoneOffset.ofHours(-5);
const IST = ZoneOffset.ofHoursMinutes(5, 30);

const NOW = Instant.parse('2026-07-01T00:00:00.000Z');
const june = { kind: 'absolute', granularity: 'month', year: 2026, month: 6 } as const;

describe('resolveTimeBound — an absolute since is the start of the period in the injected zone', () => {
  it.each([
    ['UTC', UTC, '2026-06-01T00:00:00.000Z'],
    ['+10:00', AEST, '2026-05-31T14:00:00.000Z'],
    ['-05:00', EST, '2026-06-01T05:00:00.000Z'],
    ['+05:30', IST, '2026-05-31T18:30:00.000Z'],
  ] as const)('%s: June opens at its local first', (_label, zone, expected) => {
    const actual = resolveTimeBound(june, 'since', Clock.fixed(NOW, zone));
    expect(actual).toBe(expected);
  });
});

describe('resolveTimeBound — an absolute until is the last millisecond of the period in the injected zone', () => {
  it.each([
    ['UTC', UTC, '2026-06-30T23:59:59.999Z'],
    ['+10:00', AEST, '2026-06-30T13:59:59.999Z'],
    ['-05:00', EST, '2026-07-01T04:59:59.999Z'],
    ['+05:30', IST, '2026-06-30T18:29:59.999Z'],
  ] as const)('%s: June closes at its local last millisecond', (_label, zone, expected) => {
    const actual = resolveTimeBound(june, 'until', Clock.fixed(NOW, zone));
    expect(actual).toBe(expected);
  });
});

describe('resolveTimeBound — absolute granularity in a fixed zone (+10:00)', () => {
  it('a day since opens at the local midnight of that day', () => {
    const expected = '2026-06-19T14:00:00.000Z';
    const actual = resolveTimeBound({ kind: 'absolute', granularity: 'day', year: 2026, month: 6, day: 20 }, 'since', Clock.fixed(NOW, AEST));
    expect(actual).toBe(expected);
  });

  it('a day until closes at the local last millisecond of that day', () => {
    const expected = '2026-06-20T13:59:59.999Z';
    const actual = resolveTimeBound({ kind: 'absolute', granularity: 'day', year: 2026, month: 6, day: 20 }, 'until', Clock.fixed(NOW, AEST));
    expect(actual).toBe(expected);
  });

  it('a year since opens at local 1 January', () => {
    const expected = '2025-12-31T14:00:00.000Z';
    const actual = resolveTimeBound({ kind: 'absolute', granularity: 'year', year: 2026 }, 'since', Clock.fixed(NOW, AEST));
    expect(actual).toBe(expected);
  });

  it('a year until closes at the local last millisecond of 31 December', () => {
    const expected = '2026-12-31T13:59:59.999Z';
    const actual = resolveTimeBound({ kind: 'absolute', granularity: 'year', year: 2026 }, 'until', Clock.fixed(NOW, AEST));
    expect(actual).toBe(expected);
  });
});

describe('resolveTimeBound — a relative span is now minus the span, at the injected zone', () => {
  it('a day span is exactly that many days earlier', () => {
    const expected = '2026-01-08T00:00:00.000Z';
    const actual = resolveTimeBound({ kind: 'relative', amount: 7, unit: 'd' }, 'since', Clock.fixed(Instant.parse('2026-01-15T00:00:00.000Z'), UTC));
    expect(actual).toBe(expected);
  });

  it('a month span is calendar months earlier', () => {
    const expected = '2026-01-15T00:00:00.000Z';
    const actual = resolveTimeBound({ kind: 'relative', amount: 3, unit: 'm' }, 'since', Clock.fixed(Instant.parse('2026-04-15T00:00:00.000Z'), UTC));
    expect(actual).toBe(expected);
  });

  it('a year span is a calendar year earlier', () => {
    const expected = '2025-04-15T00:00:00.000Z';
    const actual = resolveTimeBound({ kind: 'relative', amount: 1, unit: 'y' }, 'until', Clock.fixed(Instant.parse('2026-04-15T00:00:00.000Z'), UTC));
    expect(actual).toBe(expected);
  });
});

describe('resolveTimeBound — the same value in since and until spans the whole period inclusively', () => {
  it('June since..until brackets a mid-June instant in the injected zone', () => {
    const since = resolveTimeBound(june, 'since', Clock.fixed(NOW, AEST));
    const until = resolveTimeBound(june, 'until', Clock.fixed(NOW, AEST));
    const midJune = '2026-06-15T03:00:00.000Z';

    const expected = true;
    const actual = since <= midJune && midJune <= until;
    expect(actual).toBe(expected);
  });
});
