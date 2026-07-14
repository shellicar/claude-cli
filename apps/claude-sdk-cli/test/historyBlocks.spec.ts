import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import { describe, expect, it } from 'vitest';
import { toHistoryBlocks } from '../src/persistence/historyBlocks.js';

describe('toHistoryBlocks — bare string', () => {
  it('becomes a single text block', () => {
    const expected = [{ seq: 0, type: 'text', text: 'hello' }];
    const actual = toHistoryBlocks('hello');
    expect(actual).toEqual(expected);
  });

  it('an empty string becomes no blocks', () => {
    const expected = 0;
    const actual = toHistoryBlocks('').length;
    expect(actual).toBe(expected);
  });
});

describe('toHistoryBlocks — content blocks', () => {
  it('keeps the block sequence', () => {
    const content = [
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
    ] satisfies BetaContentBlockParam[];

    const expected = [0, 1];
    const actual = toHistoryBlocks(content).map((block) => block.seq);
    expect(actual).toEqual(expected);
  });

  it('pulls the text from a text block', () => {
    const content = [{ type: 'text', text: 'prose' }] satisfies BetaContentBlockParam[];

    const expected = 'prose';
    const actual = toHistoryBlocks(content)[0].text;
    expect(actual).toBe(expected);
  });

  it('pulls the reasoning from a thinking block', () => {
    const content = [{ type: 'thinking', thinking: 'the reasoning', signature: 'sig' }] satisfies BetaContentBlockParam[];

    const expected = 'the reasoning';
    const actual = toHistoryBlocks(content)[0].text;
    expect(actual).toBe(expected);
  });

  it('renders a tool_use block as its name and arguments', () => {
    const content = [{ type: 'tool_use', id: 'tu1', name: 'ReadFile', input: { path: '/x' } }] satisfies BetaContentBlockParam[];

    const expected = 'ReadFile {"path":"/x"}';
    const actual = toHistoryBlocks(content)[0].text;
    expect(actual).toBe(expected);
  });

  it('pulls a string tool_result content', () => {
    const content = [{ type: 'tool_result', tool_use_id: 'tu1', content: 'the result' }] satisfies BetaContentBlockParam[];

    const expected = 'the result';
    const actual = toHistoryBlocks(content)[0].text;
    expect(actual).toBe(expected);
  });

  it('joins the text parts of a structured tool_result', () => {
    const content = [
      {
        type: 'tool_result',
        tool_use_id: 'tu1',
        content: [
          { type: 'text', text: 'line one' },
          { type: 'text', text: 'line two' },
        ],
      },
    ] satisfies BetaContentBlockParam[];

    const expected = 'line one\nline two';
    const actual = toHistoryBlocks(content)[0].text;
    expect(actual).toBe(expected);
  });

  it('keeps a non-text block with a null text', () => {
    const content = [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] satisfies BetaContentBlockParam[];

    const expected = { seq: 0, type: 'image', text: null };
    const actual = toHistoryBlocks(content)[0];
    expect(actual).toEqual(expected);
  });
});
