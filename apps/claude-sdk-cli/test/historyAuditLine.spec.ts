import { describe, expect, it } from 'vitest';
import { parseAuditLine } from '../src/persistence/historyAuditLine.js';

const v2 = JSON.stringify({
  role: 'assistant',
  id: 'm1',
  turnId: 't1',
  queryId: 'q1',
  timestamp: '2026-01-01T00:00:00Z',
  content: [{ type: 'text', text: 'hello' }],
});

const CONVERSATION = 'conv-1';

describe('parseAuditLine — v2 line', () => {
  it('parses the ids and role', () => {
    const expected = { id: 'm1', turnId: 't1', queryId: 'q1', timestamp: '2026-01-01T00:00:00Z', role: 'assistant' };
    const parsed = parseAuditLine(v2, CONVERSATION);
    const actual = parsed === null ? null : { id: parsed.id, turnId: parsed.turnId, queryId: parsed.queryId, timestamp: parsed.timestamp, role: parsed.role };
    expect(actual).toEqual(expected);
  });

  it('stamps the conversationId passed in', () => {
    const expected = CONVERSATION;
    const actual = parseAuditLine(v2, CONVERSATION)?.conversationId;
    expect(actual).toBe(expected);
  });

  it('extracts the content blocks', () => {
    const expected = [{ seq: 0, type: 'text', text: 'hello' }];
    const actual = parseAuditLine(v2, CONVERSATION)?.blocks;
    expect(actual).toEqual(expected);
  });

  it('reads a user line as the user role', () => {
    const line = JSON.stringify({ role: 'user', id: 'u1', turnId: 't1', queryId: 'q1', timestamp: '2026-01-01T00:00:00Z', content: 'a question' });

    const expected = 'user';
    const actual = parseAuditLine(line, CONVERSATION)?.role;
    expect(actual).toBe(expected);
  });
});

describe('parseAuditLine — ignored lines', () => {
  it('returns null for a v1 line with no ids', () => {
    const line = JSON.stringify({ role: 'assistant', id: 'old', timestamp: '2025-01-01T00:00:00Z', content: [{ type: 'text', text: 'legacy' }] });

    const actual = parseAuditLine(line, CONVERSATION);
    expect(actual).toBeNull();
  });
});
