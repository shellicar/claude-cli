import { Instant } from '@js-joda/core';

/**
 * A timestamp that survived a scan, or null if it is not one.
 *
 * A scan lifts these by matching bytes in a file another tool may have written, so the value is a
 * string that looked like a timestamp, not a timestamp. Everything downstream parses it to format a
 * time or a duration, and a parse that throws there is not a spoiled line: the render runs in a
 * deferred callback with nothing catching it, so the process exits.
 *
 * Checked where the value leaves the scan rather than as each line is read. A summary keeps two
 * timestamps out of the whole file and a peek keeps one per shown line, so the cost is bounded by
 * what is displayed rather than by the size of the conversation.
 */
export const validTimestamp = (candidate: string | null | undefined): string | null => {
  if (candidate == null) {
    return null;
  }
  try {
    Instant.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
};
