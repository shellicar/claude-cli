import type { Anthropic } from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { Conversation } from '../src/private/Conversation.js';

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

function texts(conversation: Conversation): (string | undefined)[] {
  return conversation.messages.map((m) => (m.content as { text: string }[])[0]?.text);
}

// ---------------------------------------------------------------------------
// push / messages
// ---------------------------------------------------------------------------

describe('Conversation.push / messages', () => {
  it('starts empty', () => {
    const actual = new Conversation().messages.length;
    expect(actual).toBe(0);
  });

  it('appends messages in order', () => {
    const c = new Conversation();
    c.push(msg('user', 'hello'));
    c.push(msg('assistant', 'hi'));
    c.push(msg('user', 'bye'));
    const expected = ['hello', 'hi', 'bye'];
    const actual = texts(c);
    expect(actual).toEqual(expected);
  });

  it('message count after multiple pushes', () => {
    const c = new Conversation();
    c.push(msg('user', 'a'));
    c.push(msg('assistant', 'b'));
    c.push(msg('user', 'c'));
    const expected = 3;
    const actual = c.messages.length;
    expect(actual).toBe(expected);
  });

  it('merges consecutive user messages into one entry', () => {
    const c = new Conversation();
    c.push(msg('user', 'part one'));
    c.push(msg('user', 'part two'));
    const expected = 1;
    const actual = c.messages.length;
    expect(actual).toBe(expected);
  });

  it('merged user message has combined content', () => {
    const c = new Conversation();
    c.push(msg('user', 'part one'));
    c.push(msg('user', 'part two'));
    const content = c.messages[0]?.content as { text: string }[];
    const expected = ['part one', 'part two'];
    const actual = content.map((b) => b.text);
    expect(actual).toEqual(expected);
  });

  it('does not merge consecutive assistant messages', () => {
    const c = new Conversation();
    c.push(msg('assistant', 'first'));
    c.push(msg('assistant', 'second'));
    const expected = 2;
    const actual = c.messages.length;
    expect(actual).toBe(expected);
  });

  it('clears all prior messages on compaction', () => {
    const c = new Conversation();
    c.push(msg('user', 'old'));
    c.push(msg('assistant', 'old reply'));
    c.push(compactionMsg());
    const expected = 1;
    const actual = c.messages.length;
    expect(actual).toBe(expected);
  });

  it('keeps the compaction message after clear', () => {
    const c = new Conversation();
    c.push(msg('user', 'old'));
    c.push(compactionMsg());
    const expected = 'compaction';
    const actual = (c.messages[0]?.content as { type: string }[])[0]?.type;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// id tagging and remove
// ---------------------------------------------------------------------------

describe('Conversation id tagging and remove', () => {
  it('remove returns true when id exists', () => {
    const c = new Conversation();
    c.push(msg('user', 'hello'));
    c.push(msg('assistant', 'context'), { id: 'ctx-1' });
    const expected = true;
    const actual = c.remove('ctx-1');
    expect(actual).toBe(expected);
  });

  it('remove decreases message count', () => {
    const c = new Conversation();
    c.push(msg('user', 'hello'));
    c.push(msg('assistant', 'context'), { id: 'ctx-1' });
    c.remove('ctx-1');
    const expected = 1;
    const actual = c.messages.length;
    expect(actual).toBe(expected);
  });

  it('remove leaves remaining messages intact', () => {
    const c = new Conversation();
    c.push(msg('user', 'hello'));
    c.push(msg('assistant', 'context'), { id: 'ctx-1' });
    c.push(msg('user', 'follow up'));
    c.remove('ctx-1');
    const expected = ['hello', 'follow up'];
    const actual = texts(c);
    expect(actual).toEqual(expected);
  });

  it('remove returns false when id is not found', () => {
    const c = new Conversation();
    c.push(msg('user', 'hello'));
    const expected = false;
    const actual = c.remove('nonexistent');
    expect(actual).toBe(expected);
  });

  it('remove does not change message count when id is not found', () => {
    const c = new Conversation();
    c.push(msg('user', 'hello'));
    c.remove('nonexistent');
    const expected = 1;
    const actual = c.messages.length;
    expect(actual).toBe(expected);
  });

  it('remove targets the last message with the given id', () => {
    const c = new Conversation();
    c.push(msg('assistant', 'first tagged'), { id: 'dup' });
    c.push(msg('user', 'separator'));
    c.push(msg('assistant', 'second tagged'), { id: 'dup' });
    c.remove('dup');
    const expected = ['first tagged', 'separator'];
    const actual = texts(c);
    expect(actual).toEqual(expected);
  });

  it('merged user messages lose their id tag', () => {
    const c = new Conversation();
    c.push(msg('user', 'first'), { id: 'tagged' });
    c.push(msg('user', 'second')); // triggers merge — tag on 'first' is dropped
    const expected = false;
    const actual = c.remove('tagged');
    expect(actual).toBe(expected);
  });

  it('merged message content is preserved even after tag is lost', () => {
    const c = new Conversation();
    c.push(msg('user', 'first'), { id: 'tagged' });
    c.push(msg('user', 'second'));
    c.remove('tagged');
    const expected = 1;
    const actual = c.messages.length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// compaction edge cases
// ---------------------------------------------------------------------------

describe('Conversation compaction edge cases', () => {
  it('compaction clears tagged messages', () => {
    const c = new Conversation();
    c.push(msg('user', 'old'), { id: 'old-ctx' });
    c.push(compactionMsg());
    const expected = false;
    const actual = c.remove('old-ctx');
    expect(actual).toBe(expected);
  });

  it('only compaction message remains after compaction clears history', () => {
    const c = new Conversation();
    c.push(msg('user', 'old'), { id: 'old-ctx' });
    c.push(compactionMsg());
    const expected = 1;
    const actual = c.messages.length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// load (raw initialization — bypasses merge and compaction logic)
// ---------------------------------------------------------------------------

describe('Conversation.load', () => {
  it('populates messages from raw items', () => {
    const c = new Conversation();
    c.load([{ msg: msg('user', 'loaded') }, { msg: msg('assistant', 'reply') }]);
    const expected = 2;
    const actual = c.messages.length;
    expect(actual).toBe(expected);
  });

  it('does not apply merge logic during load', () => {
    // Two consecutive user messages loaded directly should remain separate.
    const c = new Conversation();
    c.load([{ msg: msg('user', 'a') }, { msg: msg('user', 'b') }]);
    const expected = 2;
    const actual = c.messages.length;
    expect(actual).toBe(expected);
  });

  it('loaded messages appear before subsequent pushes', () => {
    const c = new Conversation();
    c.load([{ msg: msg('user', 'loaded') }]);
    c.push(msg('assistant', 'pushed'));
    const expected = ['loaded', 'pushed'];
    const actual = texts(c);
    expect(actual).toEqual(expected);
  });
});
