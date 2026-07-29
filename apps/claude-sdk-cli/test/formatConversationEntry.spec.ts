import { Instant, ZoneId, ZoneOffset } from '@js-joda/core';
import { describe, expect, it } from 'vitest';
import { formatAge, formatCost, formatModel, formatSpan, formatTimeOfDay, formatTokens, oneLine } from '../src/view/formatConversationEntry.js';

const UTC = ZoneId.UTC;

describe('formatTimeOfDay', () => {
  it('renders hours, minutes and seconds', () => {
    const expected = '13:37:50';
    const actual = formatTimeOfDay('2026-07-28T13:37:50.000Z', UTC);
    expect(actual).toBe(expected);
  });

  it('keeps the seconds field when the seconds are zero', () => {
    const expected = '21:28:00';
    const actual = formatTimeOfDay('2026-07-29T21:28:00.000Z', UTC);
    expect(actual).toBe(expected);
  });

  it('keeps the hours field when the hour is early', () => {
    const expected = '02:05:09';
    const actual = formatTimeOfDay('2026-07-29T02:05:09.000Z', UTC);
    expect(actual).toBe(expected);
  });

  // A fixed offset rather than a named zone: named zones need @js-joda/timezone, which this
  // package does not carry, and the behaviour under test is the offset shift either way.
  it('renders in the given zone, not UTC', () => {
    const expected = '23:37:50';
    const actual = formatTimeOfDay('2026-07-28T13:37:50.000Z', ZoneOffset.ofHours(10));
    expect(actual).toBe(expected);
  });

  it('shows a placeholder when the message has no timestamp', () => {
    const expected = '--:--:--';
    const actual = formatTimeOfDay(null, UTC);
    expect(actual).toBe(expected);
  });
});

describe('formatSpan', () => {
  it('renders hours and minutes for a long conversation', () => {
    const expected = '3h 22m';
    const actual = formatSpan('2026-07-28T10:15:14.000Z', '2026-07-28T13:37:50.000Z');
    expect(actual).toBe(expected);
  });

  it('renders minutes alone under an hour', () => {
    const expected = '3m';
    const actual = formatSpan('2026-07-28T13:56:36.000Z', '2026-07-28T13:59:39.000Z');
    expect(actual).toBe(expected);
  });

  it('renders seconds for a conversation under a minute', () => {
    const expected = '42s';
    const actual = formatSpan('2026-07-28T13:56:36.000Z', '2026-07-28T13:57:18.000Z');
    expect(actual).toBe(expected);
  });
});

describe('formatAge', () => {
  const NOW = Instant.parse('2026-07-29T14:00:00.000Z');

  it('renders days for a conversation from a previous day', () => {
    const expected = '1d ago';
    const actual = formatAge('2026-07-28T13:37:50.000Z', NOW);
    expect(actual).toBe(expected);
  });

  it('renders hours within the day', () => {
    const expected = '3h ago';
    const actual = formatAge('2026-07-29T10:30:00.000Z', NOW);
    expect(actual).toBe(expected);
  });

  it('renders minutes within the hour', () => {
    const expected = '22m ago';
    const actual = formatAge('2026-07-29T13:38:00.000Z', NOW);
    expect(actual).toBe(expected);
  });

  it('says just now under a minute', () => {
    const expected = 'just now';
    const actual = formatAge('2026-07-29T13:59:30.000Z', NOW);
    expect(actual).toBe(expected);
  });
});

describe('formatTokens', () => {
  it('renders millions compactly', () => {
    const expected = '1.2M';
    const actual = formatTokens(1_200_000);
    expect(actual).toBe(expected);
  });

  it('renders thousands compactly', () => {
    const expected = '407.2k';
    const actual = formatTokens(407_198);
    expect(actual).toBe(expected);
  });

  it('renders a small count as it is', () => {
    const expected = '512';
    const actual = formatTokens(512);
    expect(actual).toBe(expected);
  });
});

describe('formatModel', () => {
  it('drops the vendor prefix', () => {
    const expected = 'sonnet-5';
    const actual = formatModel('claude-sonnet-5');
    expect(actual).toBe(expected);
  });

  it('leaves a model without the prefix alone', () => {
    const expected = 'some-other-model';
    const actual = formatModel('some-other-model');
    expect(actual).toBe(expected);
  });
});

describe('formatCost', () => {
  it('matches the status line to four decimals', () => {
    const expected = '$16.2400';
    const actual = formatCost(16.24);
    expect(actual).toBe(expected);
  });
});

describe('oneLine', () => {
  it('collapses a multi-line message to a single line', () => {
    const expected = 'first line second line';
    const actual = oneLine('first line\nsecond line');
    expect(actual).toBe(expected);
  });

  it('closes up runs of whitespace', () => {
    const expected = 'spaced out';
    const actual = oneLine('spaced     out');
    expect(actual).toBe(expected);
  });
});
