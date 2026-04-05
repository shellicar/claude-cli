import type { Anthropic } from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { ConversationHistory } from '../src/private/ConversationHistory.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Role = Anthropic.Beta.Messages.BetaMessageParam['role'];

function msg(role: Role, text: string): Anthropic.Beta.Messages.BetaMessageParam {
  return { role, content: [{ type: 'text', text }] };
}

function compactionMsg(): Anthropic.Beta.Messages.BetaMessageParam {
  return {
    role: 'user',
    content: [{ type: 'compaction', summary: 'summary', llm_identifier: 'claude-3-5-sonnet-20241022' }],
  } as unknown as Anthropic.Beta.Messages.BetaMessageParam;
}

// ---------------------------------------------------------------------------
// push + messages
// ---------------------------------------------------------------------------

describe('ConversationHistory.push / messages', () => {
  it('appends messages in order', () => {
    const h = new ConversationHistory();
    h.push(msg('user', 'hello'));
    h.push(msg('assistant', 'hi'));
    h.push(msg('user', 'bye'));

    const msgs = h.messages;
    expect(msgs).toHaveLength(3);
    expect((msgs[0]!.content as { text: string }[])[0]!.text).toBe('hello');
    expect((msgs[1]!.content as { text: string }[])[0]!.text).toBe('hi');
    expect((msgs[2]!.content as { text: string }[])[0]!.text).toBe('bye');
  });

  it('merges consecutive user messages into one', () => {
    const h = new ConversationHistory();
    h.push(msg('user', 'part one'));
    h.push(msg('user', 'part two'));

    const msgs = h.messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe('user');
    const content = msgs[0]!.content as { text: string }[];
    expect(content).toHaveLength(2);
    expect(content[0]!.text).toBe('part one');
    expect(content[1]!.text).toBe('part two');
  });

  it('does NOT merge consecutive assistant messages', () => {
    // assistant→assistant is not typical but the class should not merge them
    const h = new ConversationHistory();
    h.push(msg('assistant', 'first'));
    h.push(msg('assistant', 'second'));

    expect(h.messages).toHaveLength(2);
  });

  it('clears history when a compaction block is pushed', () => {
    const h = new ConversationHistory();
    h.push(msg('user', 'old message 1'));
    h.push(msg('assistant', 'old reply'));
    expect(h.messages).toHaveLength(2);

    h.push(compactionMsg());

    // Only the compaction message should remain
    const msgs = h.messages;
    expect(msgs).toHaveLength(1);
    expect((msgs[0]!.content as { type: string }[])[0]!.type).toBe('compaction');
  });

  it('starts empty with no history file', () => {
    const h = new ConversationHistory();
    expect(h.messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// push with id / remove
// ---------------------------------------------------------------------------

describe('ConversationHistory id tagging + remove', () => {
  it('tags a message and remove() finds it', () => {
    const h = new ConversationHistory();
    h.push(msg('user', 'hello'));
    h.push(msg('assistant', 'context injection'), { id: 'ctx-1' });
    h.push(msg('user', 'follow up'));

    expect(h.messages).toHaveLength(3);
    const removed = h.remove('ctx-1');
    expect(removed).toBe(true);
    expect(h.messages).toHaveLength(2);
    expect((h.messages[0]!.content as { text: string }[])[0]!.text).toBe('hello');
    expect((h.messages[1]!.content as { text: string }[])[0]!.text).toBe('follow up');
  });

  it('remove() returns false when id is not found', () => {
    const h = new ConversationHistory();
    h.push(msg('user', 'hello'));
    expect(h.remove('nonexistent')).toBe(false);
    expect(h.messages).toHaveLength(1);
  });

  it('remove() targets the LAST message with the given id', () => {
    const h = new ConversationHistory();
    h.push(msg('assistant', 'first tagged'), { id: 'dup' });
    // A non-user message in between so there's no merge issue
    h.push(msg('user', 'separator'));
    h.push(msg('assistant', 'second tagged'), { id: 'dup' });

    // Should remove the last one
    expect(h.remove('dup')).toBe(true);
    const msgs = h.messages;
    expect(msgs).toHaveLength(2);
    expect((msgs[0]!.content as { text: string }[])[0]!.text).toBe('first tagged');
    expect((msgs[1]!.content as { text: string }[])[0]!.text).toBe('separator');
  });

  it('merging consecutive user messages drops the id tag', () => {
    const h = new ConversationHistory();
    h.push(msg('user', 'first'), { id: 'tagged' });
    h.push(msg('user', 'second')); // triggers merge — tag on 'first' is dropped

    // The merged message should NOT be findable by the old id
    expect(h.remove('tagged')).toBe(false);
    // But content is merged
    expect(h.messages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// compaction interaction with id/remove
// ---------------------------------------------------------------------------

describe('ConversationHistory compaction edge cases', () => {
  it('compaction clears tagged messages too', () => {
    const h = new ConversationHistory();
    h.push(msg('user', 'old'), { id: 'old-ctx' });
    h.push(compactionMsg());

    // Everything before compaction is gone
    expect(h.remove('old-ctx')).toBe(false);
    expect(h.messages).toHaveLength(1);
  });
});
