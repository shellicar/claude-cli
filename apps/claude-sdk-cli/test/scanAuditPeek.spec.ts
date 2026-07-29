import { describe, expect, it } from 'vitest';
import { scanAuditPeek } from '../src/conversations/scanAuditPeek.js';

const userLine = (text: string, timestamp = '2026-07-28T10:00:00.000Z'): string => JSON.stringify({ role: 'user', timestamp, content: [{ type: 'text', text }] });

const assistantLine = (text: string, timestamp = '2026-07-28T10:01:00.000Z'): string => JSON.stringify({ timestamp, role: 'assistant', content: [{ type: 'text', text }] });

const toolUseLine = (timestamp = '2026-07-28T10:02:00.000Z'): string => JSON.stringify({ timestamp, role: 'assistant', content: [{ type: 'tool_use', name: 'EditFile', input: {} }] });

const toolResultLine = (timestamp = '2026-07-28T10:03:00.000Z'): string => JSON.stringify({ role: 'user', timestamp, content: [{ type: 'tool_result', content: 'done' }] });

const auditOf = (...lines: string[]): Buffer => Buffer.from(`${lines.join('\n')}\n`, 'utf-8');

describe('scanAuditPeek — ordering', () => {
  it('returns messages oldest first', () => {
    const bytes = auditOf(userLine('the ask'), assistantLine('the reply'));
    const expected = ['the ask', 'the reply'];
    const actual = scanAuditPeek(bytes, 10).entries.map((entry) => entry.text);
    expect(actual).toEqual(expected);
  });

  it('keeps the newest messages when the limit cuts the conversation', () => {
    const bytes = auditOf(userLine('first'), assistantLine('second'), userLine('third'));
    const expected = ['second', 'third'];
    const actual = scanAuditPeek(bytes, 2).entries.map((entry) => entry.text);
    expect(actual).toEqual(expected);
  });

  it('reports how many messages it did not reach', () => {
    const bytes = auditOf(userLine('first'), assistantLine('second'), userLine('third'));
    const expected = 1;
    const actual = scanAuditPeek(bytes, 2).earlier;
    expect(actual).toBe(expected);
  });

  it('reports nothing earlier when the whole conversation fits', () => {
    const bytes = auditOf(userLine('first'), assistantLine('second'));
    const expected = 0;
    const actual = scanAuditPeek(bytes, 10).earlier;
    expect(actual).toBe(expected);
  });
});

describe('scanAuditPeek — roles', () => {
  it('marks a user message', () => {
    const bytes = auditOf(userLine('the ask'));
    const expected = 'user';
    const actual = scanAuditPeek(bytes, 10).entries[0]?.kind;
    expect(actual).toBe(expected);
  });

  it('marks an assistant message', () => {
    const bytes = auditOf(assistantLine('the reply'));
    const expected = 'assistant';
    const actual = scanAuditPeek(bytes, 10).entries[0]?.kind;
    expect(actual).toBe(expected);
  });
});

describe('scanAuditPeek — tool runs', () => {
  it('counts one tool per execution, not one per message', () => {
    const bytes = auditOf(userLine('the ask'), toolUseLine(), toolResultLine(), toolUseLine(), toolResultLine(), assistantLine('the reply'));
    const expected = ['the ask', '2 tools', 'the reply'];
    const actual = scanAuditPeek(bytes, 10).entries.map((entry) => entry.text);
    expect(actual).toEqual(expected);
  });

  it('names a single tool in the singular', () => {
    const bytes = auditOf(userLine('the ask'), toolUseLine(), toolResultLine(), assistantLine('the reply'));
    const expected = '1 tool';
    const actual = scanAuditPeek(bytes, 10).entries[1]?.text;
    expect(actual).toBe(expected);
  });

  it('keeps separate tool runs separate', () => {
    const bytes = auditOf(toolResultLine(), assistantLine('between'), toolResultLine());
    const expected = 3;
    const actual = scanAuditPeek(bytes, 10).entries.length;
    expect(actual).toBe(expected);
  });

  it('counts a collapsed run as one entry against the limit', () => {
    const bytes = auditOf(userLine('the ask'), toolResultLine(), toolResultLine(), toolResultLine(), assistantLine('the reply'));
    const expected = ['the ask', '3 tools', 'the reply'];
    const actual = scanAuditPeek(bytes, 3).entries.map((entry) => entry.text);
    expect(actual).toEqual(expected);
  });

  it('gives an assistant tool call no line of its own, since its result carries the count', () => {
    const bytes = auditOf(userLine('the ask'), toolUseLine(), assistantLine('the reply'));
    const expected = ['the ask', 'the reply'];
    const actual = scanAuditPeek(bytes, 10).entries.map((entry) => entry.text);
    expect(actual).toEqual(expected);
  });

  it('gives a thinking-only assistant turn no line of its own', () => {
    const thinkingLine = JSON.stringify({ role: 'assistant', timestamp: '2026-07-28T10:04:00.000Z', content: [{ type: 'thinking', thinking: 'working it out' }] });
    const bytes = auditOf(userLine('the ask'), thinkingLine, assistantLine('the reply'));
    const expected = ['the ask', 'the reply'];
    const actual = scanAuditPeek(bytes, 10).entries.map((entry) => entry.text);
    expect(actual).toEqual(expected);
  });
});

describe('scanAuditPeek — system reminders', () => {
  const reminderLedLine = (text: string): string =>
    JSON.stringify({
      role: 'user',
      timestamp: '2026-07-28T10:00:00.000Z',
      content: [
        { type: 'text', text: '<system-reminder>\nskills catalogue\n</system-reminder>\n\n' },
        { type: 'text', text },
      ],
    });

  const reminderOnlyLine = (): string => JSON.stringify({ role: 'user', timestamp: '2026-07-28T10:00:30.000Z', content: [{ type: 'text', text: '<system-reminder>\nclock stamp\n</system-reminder>' }] });

  it('shows what the operator said, not the reminders leading the message', () => {
    const bytes = auditOf(reminderLedLine('can we strip system reminders please'));
    const expected = 'can we strip system reminders please';
    const actual = scanAuditPeek(bytes, 10).entries[0]?.text;
    expect(actual).toBe(expected);
  });

  it('drops a message that is only reminders', () => {
    const bytes = auditOf(userLine('the ask'), reminderOnlyLine(), assistantLine('the reply'));
    const expected = ['the ask', 'the reply'];
    const actual = scanAuditPeek(bytes, 10).entries.map((entry) => entry.text);
    expect(actual).toEqual(expected);
  });

  it('does not count a reminder-only message as tool activity', () => {
    const bytes = auditOf(reminderOnlyLine(), toolResultLine());
    const expected = ['1 tool'];
    const actual = scanAuditPeek(bytes, 10).entries.map((entry) => entry.text);
    expect(actual).toEqual(expected);
  });
});

describe('scanAuditPeek — edge cases', () => {
  it('reads an empty file as no entries', () => {
    const expected = 0;
    const actual = scanAuditPeek(Buffer.alloc(0), 10).entries.length;
    expect(actual).toBe(expected);
  });

  it('carries each message timestamp', () => {
    const bytes = auditOf(userLine('the ask', '2026-07-28T10:15:14.000Z'));
    const expected = '2026-07-28T10:15:14.000Z';
    const actual = scanAuditPeek(bytes, 10).entries[0]?.timestampUtc;
    expect(actual).toBe(expected);
  });
});
