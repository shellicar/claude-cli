import { describe, expect, it } from 'vitest';
import { PREFIX_BYTES, SUFFIX_BYTES, scanAuditSummary } from '../src/conversations/scanAuditSummary.js';

/**
 * The summariser reads a bounded head and tail of each audit line rather than the line, which is what
 * makes the conversation view cheap. Nothing in AuditWriter knows that, so a field added to the header
 * it composes can push the fields the reader needs outside the window it looks in — and a field the
 * reader cannot find reads as absent, not as an error, so the view would show every conversation
 * costing nothing with no failure anywhere.
 *
 * These lines mirror what AuditWriter writes (see its `assistant` and `user` composition). They fail
 * when the header grows past what the reader can see, at the cause rather than at the symptom.
 */
const assistantLine = (): string =>
  JSON.stringify({
    timestamp: '2026-07-28T13:37:50.219Z',
    costUsd: 0.38673100000000005,
    cacheCreation: { fiveMinute: 0, oneHour: 300 },
    model: 'claude-sonnet-5',
    id: 'msg_011CdUY4grMQtiDvoz3CrVcp',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'the reply' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 2,
      cache_creation_input_tokens: 300,
      cache_read_input_tokens: 373761,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 300 },
      output_tokens: 139,
      service_tier: 'standard',
      inference_geo: 'not_available',
      output_tokens_details: { thinking_tokens: 0 },
    },
    turnId: '98f84714-ad5d-4221-adf0-adaf5ef37984',
    queryId: '4024fdea-294f-484e-9ca6-31b7a53a0ebd',
  });

const userLine = (): string =>
  JSON.stringify({
    role: 'user',
    id: '8aac0563-b237-4031-9c3f-088248eb127a',
    turnId: '98f84714-ad5d-4221-adf0-adaf5ef37984',
    queryId: '4024fdea-294f-484e-9ca6-31b7a53a0ebd',
    timestamp: '2026-07-28T11:58:32.511Z',
    content: [{ type: 'text', text: 'the opening ask' }],
  });

/** Where a key sits from the start of the line, which is what the head window has to reach. */
const headOffsetOf = (line: string, key: string): number => line.indexOf(`"${key}":`);
/** How far a key sits from the end, which is what the tail window has to reach. */
const tailOffsetOf = (line: string, key: string): number => line.length - line.lastIndexOf(`"${key}":`);

describe('audit line fields stay inside the summariser windows', () => {
  it('finds role within the head window of an assistant line', () => {
    expect(headOffsetOf(assistantLine(), 'role')).toBeLessThan(PREFIX_BYTES);
  });

  it('finds costUsd within the head window', () => {
    expect(headOffsetOf(assistantLine(), 'costUsd')).toBeLessThan(PREFIX_BYTES);
  });

  it('finds model within the head window', () => {
    expect(headOffsetOf(assistantLine(), 'model')).toBeLessThan(PREFIX_BYTES);
  });

  it('finds timestamp within the head window of a user line', () => {
    expect(headOffsetOf(userLine(), 'timestamp')).toBeLessThan(PREFIX_BYTES);
  });

  it('finds turnId within the head window of a user line', () => {
    expect(headOffsetOf(userLine(), 'turnId')).toBeLessThan(PREFIX_BYTES);
  });

  it('finds usage within the tail window of an assistant line', () => {
    expect(tailOffsetOf(assistantLine(), 'usage')).toBeLessThan(SUFFIX_BYTES);
  });

  it('finds queryId within the tail window of an assistant line', () => {
    expect(tailOffsetOf(assistantLine(), 'queryId')).toBeLessThan(SUFFIX_BYTES);
  });
});

describe('a written audit line summarises to its real figures', () => {
  const bytes = Buffer.from(`${userLine()}\n${assistantLine()}\n`, 'utf-8');

  it('reads the cost', () => {
    const expected = 0.38673100000000005;
    const actual = scanAuditSummary(bytes).costUsd;
    expect(actual).toBe(expected);
  });

  it('reads the model', () => {
    const expected = 'claude-sonnet-5';
    const actual = scanAuditSummary(bytes).model;
    expect(actual).toBe(expected);
  });

  it('reads the context total of the last assistant turn', () => {
    const expected = 374063;
    const actual = scanAuditSummary(bytes).contextTokens;
    expect(actual).toBe(expected);
  });

  it('counts the turn once across the pair of lines', () => {
    const expected = 1;
    const actual = scanAuditSummary(bytes).turns;
    expect(actual).toBe(expected);
  });
});
