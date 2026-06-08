import { Duration } from '@js-joda/core';
import { describe, expect, it } from 'vitest';
import { formatDuration } from '../src/view/formatDuration.js';

describe('formatDuration', () => {
  it('formats zero seconds as 0s', () => {
    const expected = '0s';
    const actual = formatDuration(Duration.ofSeconds(0));
    expect(actual).toBe(expected);
  });

  it('formats sub-second duration as 0s', () => {
    const expected = '0s';
    const actual = formatDuration(Duration.ofMillis(999));
    expect(actual).toBe(expected);
  });

  it('formats whole seconds without minutes or hours', () => {
    const expected = '42s';
    const actual = formatDuration(Duration.ofSeconds(42));
    expect(actual).toBe(expected);
  });

  it('formats minutes with seconds always shown', () => {
    const expected = '2m 5s';
    const actual = formatDuration(Duration.ofSeconds(125));
    expect(actual).toBe(expected);
  });

  it('formats exact minutes with 0s', () => {
    const expected = '2m 0s';
    const actual = formatDuration(Duration.ofSeconds(120));
    expect(actual).toBe(expected);
  });

  it('omits hours when zero even with minutes present', () => {
    const expected = '59m 59s';
    const actual = formatDuration(Duration.ofSeconds(3599));
    expect(actual).toBe(expected);
  });

  it('includes hours, minutes, and seconds when hours are present', () => {
    const expected = '1h 2m 5s';
    const actual = formatDuration(Duration.ofSeconds(3600 + 120 + 5));
    expect(actual).toBe(expected);
  });

  it('shows all units when hours are present and lower units are zero', () => {
    const expected = '1h 0m 0s';
    const actual = formatDuration(Duration.ofSeconds(3600));
    expect(actual).toBe(expected);
  });
});
