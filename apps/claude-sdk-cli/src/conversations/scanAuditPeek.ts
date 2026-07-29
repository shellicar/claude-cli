import { isSystemReminderBlock } from '@shellicar/claude-sdk';

/** One line of a peek: a message opening, or a collapsed run of tool activity. */
export type PeekEntry = {
  kind: 'user' | 'assistant' | 'tools';
  /** The message's opening text, or the number of tool messages for a collapsed run. */
  text: string;
  toolCount: number;
  timestampUtc: string | null;
};

/** What the peek shows, plus how much of the conversation it does not reach. */
export type ConversationPeek = {
  entries: readonly PeekEntry[];
  /** Messages older than the oldest entry shown — the `⋮ N earlier messages` count. */
  earlier: number;
};

const NEWLINE = 0x0a;

type AuditContent = { type?: string; text?: string };
type AuditLine = { role?: string; timestamp?: string; content?: AuditContent[] | string };

/** What a message contributes to the peek: its own words, a tool execution, or nothing at all. */
type MessageShape = { kind: 'text'; text: string } | { kind: 'tools' } | { kind: 'skip' };

/**
 * Classifies a message for the peek by what its blocks ARE, never by what they are not.
 *
 * A `tool_result` block is the tool activity: one per execution. Its matching `tool_use` is a
 * separate message, so counting both would report a run of seven tools as fourteen — and inferring
 * "tool" from the absence of text would do exactly that, as well as miscounting an image-only or
 * thinking-only message.
 *
 * Everything else is either the message's own words (its first text block that is not a
 * `<system-reminder>`) or nothing worth a line: a reminder-only message, or an assistant turn that
 * only called a tool or only thought.
 */
const shapeOf = (line: AuditLine): MessageShape => {
  if (typeof line.content === 'string') {
    return { kind: 'text', text: line.content };
  }
  if (!Array.isArray(line.content)) {
    return { kind: 'skip' };
  }
  if (line.content.some((block) => block?.type === 'tool_result')) {
    return { kind: 'tools' };
  }
  for (const block of line.content) {
    if (block?.type === 'text' && typeof block.text === 'string' && !isSystemReminderBlock(block.text)) {
      return { kind: 'text', text: block.text };
    }
  }
  return { kind: 'skip' };
};

/** Byte ranges of every line, so only the ones the peek shows are ever decoded. */
const lineRanges = (bytes: Buffer): Array<[number, number]> => {
  const ranges: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    let end = bytes.indexOf(NEWLINE, from);
    if (end < 0) {
      end = bytes.length;
    }
    if (end > from) {
      ranges.push([from, end]);
    }
    if (end >= bytes.length) {
      return ranges;
    }
    from = end + 1;
  }
};

/**
 * Reads the tail of a conversation as one line per message, newest last, for the peek.
 *
 * A message with no text — a tool call, a tool result, an assistant turn that only thought — is not a
 * line of its own: a run of them collapses to a single `tools` entry carrying the count. Without that,
 * ten lines of peek on a working conversation would show ten tool calls and nothing said. `limit`
 * counts entries after collapsing, so it is ten lines of conversation rather than ten raw messages.
 *
 * Decodes only the lines it returns, walking backwards from the end. The megabyte tool-result lines in
 * the middle are counted, never read.
 */
export function scanAuditPeek(bytes: Buffer, limit: number): ConversationPeek {
  const ranges = lineRanges(bytes);
  const entries: PeekEntry[] = [];
  let index = ranges.length - 1;

  for (; index >= 0 && entries.length < limit; index--) {
    const range = ranges[index];
    if (range === undefined) {
      continue;
    }
    const line = JSON.parse(bytes.toString('utf8', range[0], range[1])) as AuditLine;
    const shape = shapeOf(line);
    if (shape.kind === 'skip') {
      continue;
    }
    if (shape.kind === 'tools') {
      const head = entries[0];
      if (head?.kind === 'tools') {
        head.toolCount += 1;
        head.text = `${head.toolCount} tools`;
        head.timestampUtc = line.timestamp ?? head.timestampUtc;
        continue;
      }
      entries.unshift({ kind: 'tools', text: '1 tool', toolCount: 1, timestampUtc: line.timestamp ?? null });
      continue;
    }
    const role = line.role ?? 'assistant';
    entries.unshift({ kind: role === 'user' ? 'user' : 'assistant', text: shape.text, toolCount: 0, timestampUtc: line.timestamp ?? null });
  }

  return { entries, earlier: index + 1 };
}
