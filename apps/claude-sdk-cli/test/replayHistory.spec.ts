import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaThinkingBlockParam, BetaToolResultBlockParam, BetaToolUseBlockParam } from '@anthropic-ai/sdk/resources/beta.js';
import { describe, expect, it } from 'vitest';
import { replayHistory } from '../src/replayHistory.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Msg = Anthropic.Beta.Messages.BetaMessageParam;

const user = (text: string): Msg => ({ role: 'user', content: [{ type: 'text', text }] });

const assistant = (text: string): Msg => ({ role: 'assistant', content: [{ type: 'text', text }] });

const toolUse = (name: string): BetaToolUseBlockParam => ({ type: 'tool_use', id: `tu_${name}`, name, input: {} }) satisfies BetaToolUseBlockParam;

const toolResult = (id: string): BetaToolResultBlockParam => ({ type: 'tool_result', tool_use_id: id, content: 'ok' }) satisfies BetaToolResultBlockParam;

const thinking = (text: string): BetaThinkingBlockParam => ({ type: 'thinking', thinking: text, signature: 'sig' }) satisfies BetaThinkingBlockParam;

const compaction = (content: string | null): Msg => ({ role: 'assistant', content: [{ type: 'compaction' as const, content }] });

const noThinking = { showThinking: false };
const withThinking = { showThinking: true };

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

describe('replayHistory — empty input', () => {
  it('returns empty array for no messages', () => {
    const expected = 0;
    const actual = replayHistory([], noThinking).length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// User messages
// ---------------------------------------------------------------------------

describe('replayHistory — user messages', () => {
  it('user text produces a prompt block', () => {
    const expected = 'prompt';
    const actual = replayHistory([user('hello')], noThinking)[0]?.type;
    expect(actual).toBe(expected);
  });

  it('user text content is preserved', () => {
    const expected = 'hello';
    const actual = replayHistory([user('hello')], noThinking)[0]?.content;
    expect(actual).toBe(expected);
  });

  it('tool results produce a tools block', () => {
    const msg: Msg = { role: 'user', content: [toolResult('tu_1'), toolResult('tu_2')] };
    const expected = 'tools';
    const actual = replayHistory([msg], noThinking)[0]?.type;
    expect(actual).toBe(expected);
  });

  it('tool result count is shown in content', () => {
    const msg: Msg = { role: 'user', content: [toolResult('tu_1'), toolResult('tu_2')] };
    const expected = '↩ 2 results';
    const actual = replayHistory([msg], noThinking)[0]?.content;
    expect(actual).toBe(expected);
  });

  it('single tool result uses singular form', () => {
    const msg: Msg = { role: 'user', content: [toolResult('tu_1')] };
    const expected = '↩ 1 result';
    const actual = replayHistory([msg], noThinking)[0]?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Assistant messages
// ---------------------------------------------------------------------------

describe('replayHistory — assistant messages', () => {
  it('assistant text produces a response block', () => {
    const expected = 'response';
    const actual = replayHistory([assistant('hi')], noThinking)[0]?.type;
    expect(actual).toBe(expected);
  });

  it('assistant text content is preserved', () => {
    const expected = 'hi';
    const actual = replayHistory([assistant('hi')], noThinking)[0]?.content;
    expect(actual).toBe(expected);
  });

  it('tool_use produces a tools block', () => {
    const msg: Msg = { role: 'assistant', content: [toolUse('ReadFile')] };
    const expected = 'tools';
    const actual = replayHistory([msg], noThinking)[0]?.type;
    expect(actual).toBe(expected);
  });

  it('tool_use content shows arrow and name', () => {
    const msg: Msg = { role: 'assistant', content: [toolUse('ReadFile')] };
    const expected = '→ ReadFile';
    const actual = replayHistory([msg], noThinking)[0]?.content;
    expect(actual).toBe(expected);
  });

  it('multiple tool_use blocks merge into one tools block', () => {
    const msg: Msg = { role: 'assistant', content: [toolUse('ReadFile'), toolUse('Grep')] };
    const expected = 1;
    const actual = replayHistory([msg], noThinking).length;
    expect(actual).toBe(expected);
  });

  it('multiple tool_use names appear on separate lines', () => {
    const msg: Msg = { role: 'assistant', content: [toolUse('ReadFile'), toolUse('Grep')] };
    const expected = '→ ReadFile\n→ Grep';
    const actual = replayHistory([msg], noThinking)[0]?.content;
    expect(actual).toBe(expected);
  });

  it('compaction produces a compaction block', () => {
    const expected = 'compaction';
    const actual = replayHistory([compaction('summary text')], noThinking)[0]?.type;
    expect(actual).toBe(expected);
  });

  it('compaction block carries the summary text', () => {
    const expected = 'summary text';
    const actual = replayHistory([compaction('summary text')], noThinking)[0]?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Thinking blocks
// ---------------------------------------------------------------------------

describe('replayHistory — thinking blocks', () => {
  it('thinking is skipped when showThinking is false', () => {
    const msg: Msg = { role: 'assistant', content: [thinking('internal thoughts')] };
    const expected = 0;
    const actual = replayHistory([msg], noThinking).length;
    expect(actual).toBe(expected);
  });

  it('thinking produces a thinking block when showThinking is true', () => {
    const msg: Msg = { role: 'assistant', content: [thinking('internal thoughts')] };
    const expected = 'thinking';
    const actual = replayHistory([msg], withThinking)[0]?.type;
    expect(actual).toBe(expected);
  });

  it('thinking content is preserved when shown', () => {
    const msg: Msg = { role: 'assistant', content: [thinking('internal thoughts')] };
    const expected = 'internal thoughts';
    const actual = replayHistory([msg], withThinking)[0]?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Ordering and merging
// ---------------------------------------------------------------------------

describe('replayHistory — ordering and merging', () => {
  it('text before tool_use produces response block then tools block', () => {
    const msg: Msg = { role: 'assistant', content: [{ type: 'text', text: 'Looking...' }, toolUse('ReadFile')] };
    const expected = ['response', 'tools'];
    const actual = replayHistory([msg], noThinking).map((b) => b.type);
    expect(actual).toEqual(expected);
  });

  it('tool_result appends to preceding tools block from tool_use', () => {
    const asstMsg: Msg = { role: 'assistant', content: [toolUse('ReadFile')] };
    const userMsg: Msg = { role: 'user', content: [toolResult('tu_ReadFile')] };
    const expected = 1;
    const actual = replayHistory([asstMsg, userMsg], noThinking).length;
    expect(actual).toBe(expected);
  });

  it('tool_result content appended after tool_use in same block', () => {
    const asstMsg: Msg = { role: 'assistant', content: [toolUse('ReadFile')] };
    const userMsg: Msg = { role: 'user', content: [toolResult('tu_ReadFile')] };
    const expected = '→ ReadFile\n↩ 1 result';
    const actual = replayHistory([asstMsg, userMsg], noThinking)[0]?.content;
    expect(actual).toBe(expected);
  });

  it('full turn sequence produces correct block order', () => {
    const messages: Msg[] = [user('what files are here?'), { role: 'assistant', content: [{ type: 'text', text: 'Let me check.' }, toolUse('Find')] }, { role: 'user', content: [toolResult('tu_Find')] }, assistant('Here are the files.')];
    const expected = ['prompt', 'response', 'tools', 'response'];
    const actual = replayHistory(messages, noThinking).map((b) => b.type);
    expect(actual).toEqual(expected);
  });
});
