import { Clock, Instant, ZoneId } from '@js-joda/core';
import { describe, expect, it } from 'vitest';
import { formatClockStamp } from '../src/private/clockStamp.js';

describe('formatClockStamp', () => {
  it('formats a fixed instant in a named zone to the expected string', () => {
    const fixedInstant = Instant.parse('2026-05-29T04:32:15Z');
    const fixedZone = ZoneId.of('Australia/Melbourne');
    const clock = Clock.fixed(fixedInstant, fixedZone);

    const expected = 'Friday, 29 May 2026 at 14:32:15 Australia/Melbourne (+10:00)';
    const actual = formatClockStamp(clock);

    expect(actual).toBe(expected);
  });
});
