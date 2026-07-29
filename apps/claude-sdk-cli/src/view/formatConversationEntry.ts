import { DateTimeFormatter, Duration, Instant, type ZoneId } from '@js-joda/core';
import type { AuditSummary } from '../conversations/scanAuditSummary.js';

/** Shown in place of a figure whose audit file has not been read yet. */
export const PENDING = '·····';

/** Compact token count: 407198 → `407.2k`, 1200000 → `1.2M`. */
export const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return String(tokens);
};

/** Elapsed wall-clock, coarsened as it grows: `3m`, `1h 31m`, `3h 23m`. Seconds only under a minute,
 *  since a conversation's span is never interesting to the second. */
export const formatSpan = (fromUtc: string | null, toUtc: string | null): string => {
  if (fromUtc === null || toUtc === null) {
    return PENDING;
  }
  const span = Duration.between(Instant.parse(fromUtc), Instant.parse(toUtc));
  const hours = span.toHours();
  const minutes = span.toMinutes() % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${span.seconds()}s`;
};

/** How long ago, for finding "the one from this morning": `just now`, `2h ago`, `3d ago`. */
export const formatAge = (thenUtc: string | null, nowUtc: Instant): string => {
  if (thenUtc === null) {
    return PENDING;
  }
  const elapsed = Duration.between(Instant.parse(thenUtc), nowUtc);
  const days = elapsed.toDays();
  if (days > 0) {
    return `${days}d ago`;
  }
  const hours = elapsed.toHours();
  if (hours > 0) {
    return `${hours}h ago`;
  }
  const minutes = elapsed.toMinutes();
  return minutes > 0 ? `${minutes}m ago` : 'just now';
};

/** The transcript's own time format, so a conversation line reads the same in both views. Note
 *  LocalTime.toString() is not this: it omits zero seconds, so 21:28:00 renders as `21:28`. */
const TIME_FORMAT = DateTimeFormatter.ofPattern('HH:mm:ss');

/** Wall-clock time of a message, in the operator's own zone. */
export const formatTimeOfDay = (whenUtc: string | null, zone: ZoneId): string => {
  if (whenUtc === null) {
    return '--:--:--';
  }
  return Instant.parse(whenUtc).atZone(zone).toLocalTime().format(TIME_FORMAT);
};

/** The model without its vendor prefix — `claude-sonnet-5` is `sonnet-5` in a list of Claude models. */
export const formatModel = (model: string | null): string => {
  if (model === null) {
    return PENDING;
  }
  return model.startsWith('claude-') ? model.slice('claude-'.length) : model;
};

/** Cost to four decimals, matching the status line rather than inventing a second money format. */
export const formatCost = (costUsd: number): string => `$${costUsd.toFixed(4)}`;

/** Context as used-of-window with the percentage, the same shape the status line uses. */
export const formatContext = (summary: AuditSummary, contextWindow: number): string => {
  if (contextWindow <= 0) {
    return formatTokens(summary.contextTokens);
  }
  const percent = ((summary.contextTokens / contextWindow) * 100).toFixed(1);
  return `${formatTokens(summary.contextTokens)}/${formatTokens(contextWindow)} (${percent}%)`;
};

/** Collapse a message to one line: newlines become spaces, runs of whitespace close up. A preview is a
 *  single line whatever the message's own shape was. */
export const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
