import type { Anthropic } from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { ensureClaudeMdReminders } from '../src/private/claudeMdReminders';

const CACHED = ['the CLAUDE.md content'];
const CONVERSATION = ['a scratchpad is at /tmp/claude-501/abc/scratchpad'];

/** A post-compaction request clone: the opening user message is a later turn that never held the
 *  reminders, because the message that did was trimmed off. */
function postCompactionClone(): Anthropic.Beta.Messages.BetaMessageParam[] {
  return [
    { role: 'assistant', content: [{ type: 'text', text: 'the compaction summary' }] },
    { role: 'user', content: [{ type: 'text', text: 'a later ask' }] },
  ];
}

/** A pre-compaction request clone: the reminders are already the leading blocks. */
function preCompactionClone(): Anthropic.Beta.Messages.BetaMessageParam[] {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: '<system-reminder>\nthe CLAUDE.md content\n</system-reminder>\n' },
        { type: 'text', text: '<system-reminder>\na scratchpad is at /tmp/claude-501/abc/scratchpad\n</system-reminder>\n\n' },
        { type: 'text', text: 'the original ask' },
      ],
    },
  ];
}

const leadingTexts = (messages: Anthropic.Beta.Messages.BetaMessageParam[]): string[] => {
  const first = messages.find((m) => m.role === 'user');
  const content = first?.content;
  return typeof content === 'string' || content == null ? [] : content.filter((b) => b.type === 'text').map((b) => b.text);
};

// These exercise the injector on its own, and it does the right thing. It is not reached in practice
// after a compaction: TurnRunner stamps the clock onto the message first, and the guard below reads
// that stamp as proof the reminders are present. TurnRunner.spec pins that with a failing test.
describe('ensureClaudeMdReminders', () => {
  it('restores the cached reminders a compaction trimmed away', () => {
    const messages = postCompactionClone();
    ensureClaudeMdReminders(messages, [...CACHED, ...CONVERSATION]);
    expect(leadingTexts(messages).join('\n')).toContain('the CLAUDE.md content');
  });

  it('restores the per-conversation reminders a compaction trimmed away', () => {
    const messages = postCompactionClone();
    ensureClaudeMdReminders(messages, [...CACHED, ...CONVERSATION]);
    expect(leadingTexts(messages).join('\n')).toContain('/tmp/claude-501/abc/scratchpad');
  });

  it('keeps the per-conversation reminders after the cached ones, where the prefix marker leaves them', () => {
    const messages = postCompactionClone();
    ensureClaudeMdReminders(messages, [...CACHED, ...CONVERSATION]);
    const texts = leadingTexts(messages);
    const expected = true;
    const actual = texts.findIndex((t) => t.includes('scratchpad')) > texts.findIndex((t) => t.includes('CLAUDE.md'));
    expect(actual).toBe(expected);
  });

  it('adds nothing when the reminders are already leading the message', () => {
    const messages = preCompactionClone();
    const expected = leadingTexts(messages).length;
    ensureClaudeMdReminders(messages, [...CACHED, ...CONVERSATION]);
    const actual = leadingTexts(messages).length;
    expect(actual).toBe(expected);
  });

  it('adds nothing when there is nothing to restore', () => {
    const messages = postCompactionClone();
    const expected = leadingTexts(messages).length;
    ensureClaudeMdReminders(messages, []);
    const actual = leadingTexts(messages).length;
    expect(actual).toBe(expected);
  });
});
