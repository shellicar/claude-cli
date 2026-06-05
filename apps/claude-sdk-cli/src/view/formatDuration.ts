import { type Duration } from '@js-joda/core';

/**
 * Format a Duration into a human-readable string.
 *
 * Higher-order zero units are omitted; seconds are always shown.
 * Examples: '5s', '42s', '2m 5s', '2m 0s', '1h 2m 5s', '0s'
 */
export function formatDuration(d: Duration): string {
  const totalSeconds = Math.floor(d.toMillis() / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (hours > 0 || minutes > 0) {
    parts.push(`${minutes}m`);
  }
  parts.push(`${seconds}s`);

  return parts.join(' ');
}
