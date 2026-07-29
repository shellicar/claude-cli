import { describe, expect, it } from 'vitest';
import { scanAuditSummary } from '../src/conversations/scanAuditSummary.js';

type LineOverrides = {
  timestamp?: string;
  turnId?: string;
  queryId?: string;
  text?: string;
  costUsd?: number;
  model?: string;
  usage?: { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number };
};

/** A user line, in the shape this CLI writes: role and ids first, content after. */
const userLine = (o: LineOverrides = {}): string =>
  JSON.stringify({
    role: 'user',
    id: 'msg-user',
    turnId: o.turnId ?? 'turn-1',
    queryId: o.queryId ?? 'query-1',
    timestamp: o.timestamp ?? '2026-07-28T10:00:00.000Z',
    content: [{ type: 'text', text: o.text ?? 'the opening ask' }],
  });

/** An assistant line: timestamp/costUsd/model at the head, usage and ids at the tail. */
const assistantLine = (o: LineOverrides = {}): string =>
  JSON.stringify({
    timestamp: o.timestamp ?? '2026-07-28T10:01:00.000Z',
    costUsd: o.costUsd ?? 1.5,
    model: o.model ?? 'claude-sonnet-5',
    id: 'msg-assistant',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: o.text ?? 'the reply' }],
    usage: o.usage ?? { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 },
    turnId: o.turnId ?? 'turn-1',
    queryId: o.queryId ?? 'query-1',
  });

const auditOf = (...lines: string[]): Buffer => Buffer.from(`${lines.join('\n')}\n`, 'utf-8');

/** A user line carrying a huge base64 payload, as a real tool result does. */
const fatUserLine = (): string =>
  JSON.stringify({
    role: 'user',
    id: 'msg-fat',
    turnId: 'turn-fat',
    queryId: 'query-1',
    timestamp: '2026-07-28T10:02:00.000Z',
    content: [{ type: 'tool_result', content: [{ type: 'image', source: { data: 'A'.repeat(200_000) } }] }],
  });

describe('scanAuditSummary — counts', () => {
  it('counts distinct turns', () => {
    const bytes = auditOf(userLine({ turnId: 'turn-1' }), assistantLine({ turnId: 'turn-1' }), assistantLine({ turnId: 'turn-2' }));
    const expected = 2;
    const actual = scanAuditSummary(bytes).turns;
    expect(actual).toBe(expected);
  });

  it('counts distinct queries', () => {
    const bytes = auditOf(userLine({ queryId: 'query-1' }), assistantLine({ queryId: 'query-1' }), userLine({ queryId: 'query-2' }), assistantLine({ queryId: 'query-2' }));
    const expected = 2;
    const actual = scanAuditSummary(bytes).queries;
    expect(actual).toBe(expected);
  });

  it('sums the cost of every assistant line', () => {
    const bytes = auditOf(userLine(), assistantLine({ costUsd: 1.25 }), assistantLine({ costUsd: 2.5 }));
    const expected = 3.75;
    const actual = scanAuditSummary(bytes).costUsd;
    expect(actual).toBe(expected);
  });

  it('ignores user lines when summing cost', () => {
    const bytes = auditOf(userLine(), assistantLine({ costUsd: 1.25 }));
    const expected = 1.25;
    const actual = scanAuditSummary(bytes).costUsd;
    expect(actual).toBe(expected);
  });
});

describe('scanAuditSummary — timing', () => {
  it('reports the earliest timestamp', () => {
    const bytes = auditOf(userLine({ timestamp: '2026-07-28T10:00:00.000Z' }), assistantLine({ timestamp: '2026-07-28T13:37:50.000Z' }));
    const expected = '2026-07-28T10:00:00.000Z';
    const actual = scanAuditSummary(bytes).firstUtc;
    expect(actual).toBe(expected);
  });

  it('reports the latest timestamp', () => {
    const bytes = auditOf(userLine({ timestamp: '2026-07-28T10:00:00.000Z' }), assistantLine({ timestamp: '2026-07-28T13:37:50.000Z' }));
    const expected = '2026-07-28T13:37:50.000Z';
    const actual = scanAuditSummary(bytes).lastUtc;
    expect(actual).toBe(expected);
  });
});

describe('scanAuditSummary — the last assistant turn', () => {
  it('reports the model of the last assistant line', () => {
    const bytes = auditOf(assistantLine({ model: 'claude-sonnet-5' }), assistantLine({ model: 'claude-fable-5' }));
    const expected = 'claude-fable-5';
    const actual = scanAuditSummary(bytes).model;
    expect(actual).toBe(expected);
  });

  it('reports context as the last turn total, not an accumulation', () => {
    const bytes = auditOf(assistantLine({ usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 } }), assistantLine({ usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 } }));
    const expected = 60;
    const actual = scanAuditSummary(bytes).contextTokens;
    expect(actual).toBe(expected);
  });
});

describe('scanAuditSummary — preview text', () => {
  it('reports the first user message', () => {
    const bytes = auditOf(userLine({ text: 'the opening ask' }), assistantLine(), userLine({ text: 'a later ask' }));
    const expected = 'the opening ask';
    const actual = scanAuditSummary(bytes).firstUserText;
    expect(actual).toBe(expected);
  });

  it('reports the last assistant message', () => {
    const bytes = auditOf(userLine(), assistantLine({ text: 'an early reply' }), assistantLine({ text: 'the final reply' }));
    const expected = 'the final reply';
    const actual = scanAuditSummary(bytes).lastAssistantText;
    expect(actual).toBe(expected);
  });

  it('skips a line whose first block is not text', () => {
    const bytes = auditOf(fatUserLine(), userLine({ text: 'the opening ask' }));
    const expected = 'the opening ask';
    const actual = scanAuditSummary(bytes).firstUserText;
    expect(actual).toBe(expected);
  });

  it('does not decode a tool result while looking for the opening ask', () => {
    // Truncated JSON: readable in the head window, unparseable as a whole. Decoding it would throw,
    // so the summary coming back at all is the proof the payload was stepped over.
    const unparseableToolResult = `${JSON.stringify({ role: 'user', turnId: 'turn-1', queryId: 'query-1', timestamp: '2026-07-28T10:00:00.000Z', content: [{ type: 'tool_result', content: 'x'.repeat(400) }] }).slice(0, -3)}`;
    const bytes = auditOf(unparseableToolResult, userLine({ text: 'the opening ask' }));
    const expected = 'the opening ask';
    const actual = scanAuditSummary(bytes).firstUserText;
    expect(actual).toBe(expected);
  });
});

describe('scanAuditSummary — system reminders', () => {
  /** How the CLI actually writes a first user message: reminders lead, the operator's words follow. */
  const reminderLedLine = (text: string): string =>
    JSON.stringify({
      role: 'user',
      turnId: 'turn-1',
      queryId: 'query-1',
      timestamp: '2026-07-28T10:00:00.000Z',
      content: [
        { type: 'text', text: '<system-reminder>\nThe following skills are available\n</system-reminder>\n\n' },
        { type: 'text', text: '<system-reminder>\nCLAUDE.md content\n</system-reminder>\n\n' },
        { type: 'text', text },
      ],
    });

  it('previews what the operator said, not the reminders that lead the message', () => {
    const bytes = auditOf(reminderLedLine('so after all this time, i want a read only mode'));
    const expected = 'so after all this time, i want a read only mode';
    const actual = scanAuditSummary(bytes).firstUserText;
    expect(actual).toBe(expected);
  });

  it('looks past a message that is only reminders to the first one with words', () => {
    const reminderOnly = JSON.stringify({ role: 'user', turnId: 'turn-1', queryId: 'query-1', timestamp: '2026-07-28T10:00:00.000Z', content: [{ type: 'text', text: '<system-reminder>\nclock stamp\n</system-reminder>' }] });
    const bytes = auditOf(reminderOnly, userLine({ text: 'the real ask' }));
    const expected = 'the real ask';
    const actual = scanAuditSummary(bytes).firstUserText;
    expect(actual).toBe(expected);
  });
});

describe('scanAuditSummary — timestamps', () => {
  const withTimestamp = (timestamp: string): string => JSON.stringify({ role: 'user', turnId: 'turn-1', queryId: 'query-1', timestamp, content: [{ type: 'text', text: 'the ask' }] });

  it('reports a timestamp that is not a date as absent', () => {
    const bytes = auditOf(withTimestamp('not a date at all'));
    const actual = scanAuditSummary(bytes).firstUtc;
    expect(actual).toBeNull();
  });

  it('reports a truncated timestamp as absent', () => {
    const bytes = auditOf(withTimestamp('2026-07-28T13'));
    const actual = scanAuditSummary(bytes).lastUtc;
    expect(actual).toBeNull();
  });

  it('still reads the rest of the summary when a timestamp is unusable', () => {
    const bytes = auditOf(withTimestamp('not a date at all'), assistantLine({ costUsd: 2.5 }));
    const expected = 2.5;
    const actual = scanAuditSummary(bytes).costUsd;
    expect(actual).toBe(expected);
  });
});

describe('scanAuditSummary — edge cases', () => {
  it('reads an empty file as an empty summary', () => {
    const expected = 0;
    const actual = scanAuditSummary(Buffer.alloc(0)).turns;
    expect(actual).toBe(expected);
  });

  it('counts a fat tool-result line towards the turns without reading its payload', () => {
    const bytes = auditOf(userLine({ turnId: 'turn-1' }), fatUserLine());
    const expected = 2;
    const actual = scanAuditSummary(bytes).turns;
    expect(actual).toBe(expected);
  });

  it('reads no cost from a Claude Code audit file, whose fields are nested under message', () => {
    const foreign = JSON.stringify({ timestamp: '2026-03-28T09:23:53.195Z', type: 'assistant', message: { model: 'claude-sonnet-4-6', role: 'assistant', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 5 } } });
    const expected = 0;
    const actual = scanAuditSummary(auditOf(foreign)).costUsd;
    expect(actual).toBe(expected);
  });

  it('tolerates a file with no trailing newline', () => {
    const bytes = Buffer.from(`${userLine()}\n${assistantLine({ costUsd: 2 })}`, 'utf-8');
    const expected = 2;
    const actual = scanAuditSummary(bytes).costUsd;
    expect(actual).toBe(expected);
  });
});
