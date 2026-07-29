import { isSystemReminderBlock } from '@shellicar/claude-sdk';

/** What the conversation list shows for one conversation, derived from its audit file. */
export type AuditSummary = {
  /** Distinct turns — one per assistant round trip. */
  turns: number;
  /** Distinct queries — one per thing the operator asked. */
  queries: number;
  costUsd: number;
  /** ISO timestamp of the earliest line, or null when no line carries one. */
  firstUtc: string | null;
  /** ISO timestamp of the latest line. */
  lastUtc: string | null;
  /** The model of the last assistant line — what the conversation would resume on. */
  model: string | null;
  /** Context used by the last assistant turn: input + cache creation + cache read. */
  contextTokens: number;
  /** The opening ask, which says what the conversation is. */
  firstUserText: string | null;
  /** The last reply, which says where it got to. */
  lastAssistantText: string | null;
};

const EMPTY: AuditSummary = {
  turns: 0,
  queries: 0,
  costUsd: 0,
  firstUtc: null,
  lastUtc: null,
  model: null,
  contextTokens: 0,
  firstUserText: null,
  lastAssistantText: null,
};

const NEWLINE = 0x0a;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;

/** How much of a line's head holds its scalar keys. On a user line role/turnId/queryId/timestamp all
 *  sit before the content starts; on an assistant line timestamp/costUsd/model do. */
const PREFIX_BYTES = 256;
/** How much of a line's tail holds usage/turnId/queryId on an assistant line. */
const SUFFIX_BYTES = 2048;

/**
 * Value of a string key within one window. The window is a latin1 decode of a bounded slice, never
 * the whole line — a line can be megabytes of base64 in the middle, and none of it is read.
 *
 * `fromEnd` finds the LAST occurrence, which is what the tail window needs: turnId and queryId are
 * the final keys of the object, so the last match is the real one even if quoted content repeats
 * the same key text earlier in the window.
 */
const stringValue = (window: string, key: string, fromEnd: boolean): string | null => {
  const marker = `"${key}":"`;
  const at = fromEnd ? window.lastIndexOf(marker) : window.indexOf(marker);
  if (at < 0) {
    return null;
  }
  const start = at + marker.length;
  for (let i = start; i < window.length; i++) {
    const code = window.charCodeAt(i);
    if (code === BACKSLASH) {
      i++;
      continue;
    }
    if (code === QUOTE) {
      const raw = window.slice(start, i);
      return raw.includes('\\') ? (JSON.parse(`"${raw}"`) as string) : raw;
    }
  }
  return null;
};

const numberValue = (window: string, key: string): number | null => {
  const marker = `"${key}":`;
  const at = window.indexOf(marker);
  if (at < 0) {
    return null;
  }
  let i = at + marker.length;
  const start = i;
  while (i < window.length) {
    const code = window.charCodeAt(i);
    const isNumeric = (code >= 0x30 && code <= 0x39) || code === 0x2d || code === 0x2e || code === 0x65 || code === 0x45 || code === 0x2b;
    if (!isNumeric) {
      break;
    }
    i++;
  }
  return i === start ? null : Number(window.slice(start, i));
};

type AuditContent = { type?: string; text?: string };
type AuditLine = { content?: AuditContent[] | string };

/**
 * The message's own words: its first text block that is not a `<system-reminder>`.
 *
 * A user message arrives as several text blocks the API concatenates, and the CLI leads the first
 * one with reminders — the skill catalogue, CLAUDE.md, the clock stamp. Taking the first block
 * blindly previews that machinery instead of what was said, so whole reminder blocks are skipped.
 * The predicate is the SDK's own, so the preview agrees with what the SDK counts as a reminder
 * rather than drifting from it.
 *
 * Tool and thinking blocks are skipped the same way: neither is a message opening.
 */
const messageText = (line: AuditLine): string | null => {
  if (typeof line.content === 'string') {
    return line.content;
  }
  if (!Array.isArray(line.content)) {
    return null;
  }
  for (const block of line.content) {
    if (block?.type === 'text' && typeof block.text === 'string' && !isSystemReminderBlock(block.text)) {
      return block.text;
    }
  }
  return null;
};

/**
 * Derives a conversation's summary from its whole audit file, in one forward pass over the bytes.
 *
 * Two properties make this cheap enough to run on a keypress. Nothing is decoded but a bounded head
 * and tail window per line, so the megabyte tool-result lines are stepped over rather than read. And
 * `JSON.parse` runs at most twice for the file: only the first user line and the last assistant line
 * need their text, and which line is last is not known until the end, so its byte range is recorded
 * and decoded once the scan finishes.
 *
 * Returns the empty summary for a file this CLI did not write (Claude Code's audit format nests
 * everything under `message`, so none of the top-level keys are found).
 */
export function scanAuditSummary(bytes: Buffer): AuditSummary {
  const turnIds = new Set<string>();
  const queryIds = new Set<string>();
  const summary: AuditSummary = { ...EMPTY };
  let lastAssistantStart = -1;
  let lastAssistantEnd = -1;

  let from = 0;
  for (;;) {
    let end = bytes.indexOf(NEWLINE, from);
    if (end < 0) {
      end = bytes.length;
    }
    if (end > from) {
      const head = bytes.toString('latin1', from, Math.min(from + PREFIX_BYTES, end));
      const tail = bytes.toString('latin1', Math.max(from, end - SUFFIX_BYTES), end);

      const role = stringValue(head, 'role', false) ?? 'assistant';
      const timestamp = stringValue(head, 'timestamp', false);
      if (timestamp !== null) {
        if (summary.firstUtc === null || timestamp < summary.firstUtc) {
          summary.firstUtc = timestamp;
        }
        if (summary.lastUtc === null || timestamp > summary.lastUtc) {
          summary.lastUtc = timestamp;
        }
      }
      const turnId = stringValue(head, 'turnId', false) ?? stringValue(tail, 'turnId', true);
      const queryId = stringValue(head, 'queryId', false) ?? stringValue(tail, 'queryId', true);
      if (turnId !== null) {
        turnIds.add(turnId);
      }
      if (queryId !== null) {
        queryIds.add(queryId);
      }

      const usageAt = tail.lastIndexOf('"usage":{');
      if (role === 'assistant' && usageAt >= 0) {
        summary.costUsd += numberValue(head, 'costUsd') ?? 0;
        summary.model = stringValue(head, 'model', false) ?? summary.model;
        const usage = tail.slice(usageAt);
        summary.contextTokens = (numberValue(usage, 'input_tokens') ?? 0) + (numberValue(usage, 'cache_creation_input_tokens') ?? 0) + (numberValue(usage, 'cache_read_input_tokens') ?? 0);
        lastAssistantStart = from;
        lastAssistantEnd = end;
      } else if (role === 'user' && summary.firstUserText === null) {
        summary.firstUserText = messageText(JSON.parse(bytes.toString('utf8', from, end)) as AuditLine);
      }
    }
    if (end >= bytes.length) {
      break;
    }
    from = end + 1;
  }

  summary.turns = turnIds.size;
  summary.queries = queryIds.size;
  if (lastAssistantStart >= 0) {
    summary.lastAssistantText = messageText(JSON.parse(bytes.toString('utf8', lastAssistantStart, lastAssistantEnd)) as AuditLine);
  }
  return summary;
}
