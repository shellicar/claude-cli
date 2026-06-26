import type { BetaRawContentBlockDeltaEvent, BetaRawContentBlockStartEvent, BetaRawMessageDeltaEvent, BetaRawMessageStartEvent } from '@anthropic-ai/sdk/resources/beta.mjs';
import { describe, expect, it } from 'vitest';
import { MessageAccumulator } from '../src/private/http/accumulator.js';

// ---------------------------------------------------------------------------
// Event fixtures. The SDK event unions carry many required fields not relevant
// here, so fixtures are cast to the event subtype the accumulator method takes.
// ---------------------------------------------------------------------------

function messageStart(): BetaRawMessageStartEvent {
  return {
    type: 'message_start',
    message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  } as unknown as BetaRawMessageStartEvent;
}

function textBlockStart(index: number): BetaRawContentBlockStartEvent {
  return { type: 'content_block_start', index, content_block: { type: 'text', text: '' } } as unknown as BetaRawContentBlockStartEvent;
}

function toolBlockStart(index: number): BetaRawContentBlockStartEvent {
  return { type: 'content_block_start', index, content_block: { type: 'tool_use', id: 'toolu_1', name: 'X', input: {} } } as unknown as BetaRawContentBlockStartEvent;
}

function textDelta(index: number, text: string): BetaRawContentBlockDeltaEvent {
  return { type: 'content_block_delta', index, delta: { type: 'text_delta', text } } as unknown as BetaRawContentBlockDeltaEvent;
}

function inputJsonDelta(index: number, partialJson: string): BetaRawContentBlockDeltaEvent {
  return { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: partialJson } } as unknown as BetaRawContentBlockDeltaEvent;
}

function messageDelta(stopReason: string, outputTokens: number): BetaRawMessageDeltaEvent {
  return { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } } as unknown as BetaRawMessageDeltaEvent;
}

function compactionBlockStart(index: number): BetaRawContentBlockStartEvent {
  return { type: 'content_block_start', index, content_block: { type: 'compaction', content: null, encrypted_content: null } } as unknown as BetaRawContentBlockStartEvent;
}

function compactionDelta(index: number, content: string): BetaRawContentBlockDeltaEvent {
  return { type: 'content_block_delta', index, delta: { type: 'compaction_delta', content, encrypted_content: null } } as unknown as BetaRawContentBlockDeltaEvent;
}

// ---------------------------------------------------------------------------
// MessageAccumulator
// ---------------------------------------------------------------------------

describe('MessageAccumulator', () => {
  it('concatenates text deltas into the block text', () => {
    const expected = 'foobar';
    const acc = new MessageAccumulator();
    acc.start(messageStart());
    acc.startBlock(textBlockStart(0));
    acc.delta(textDelta(0, 'foo'));
    acc.delta(textDelta(0, 'bar'));

    const actual = (acc.message.content[0] as { text: string }).text;

    expect(actual).toBe(expected);
  });

  it('parses the accumulated tool-input JSON once at content_block_stop', () => {
    const expected = { a: 1 };
    const acc = new MessageAccumulator();
    acc.start(messageStart());
    acc.startBlock(toolBlockStart(0));
    acc.delta(inputJsonDelta(0, '{"a":'));
    acc.delta(inputJsonDelta(0, '1}'));

    const actual = (acc.stopBlock(0) as { input: unknown }).input;

    expect(actual).toEqual(expected);
  });

  it('yields an empty input object for a tool block with no input deltas', () => {
    const expected = {};
    const acc = new MessageAccumulator();
    acc.start(messageStart());
    acc.startBlock(toolBlockStart(0));

    const actual = (acc.stopBlock(0) as { input: unknown }).input;

    expect(actual).toEqual(expected);
  });

  it('applies the stop_reason from a message_delta', () => {
    const expected = 'tool_use';
    const acc = new MessageAccumulator();
    acc.start(messageStart());
    acc.messageDelta(messageDelta('tool_use', 7));

    const actual = acc.message.stop_reason;

    expect(actual).toBe(expected);
  });

  it('applies the output token usage from a message_delta', () => {
    const expected = 7;
    const acc = new MessageAccumulator();
    acc.start(messageStart());
    acc.messageDelta(messageDelta('tool_use', 7));

    const actual = acc.message.usage.output_tokens;

    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Compaction summary accumulation. Mirrors the SDK's old BetaMessageStream:
// compaction_delta text concatenates onto the block's `content`, exactly like
// text_delta, so the assembled compaction block surfaces its summary.
// ---------------------------------------------------------------------------

describe('MessageAccumulator — compaction', () => {
  it('concatenates compaction_delta content into the block summary', () => {
    const expected = 'First summary';
    const acc = new MessageAccumulator();
    acc.start(messageStart());
    acc.startBlock(compactionBlockStart(0));
    acc.delta(compactionDelta(0, 'First '));
    acc.delta(compactionDelta(0, 'summary'));

    const actual = (acc.stopBlock(0) as { content: string | null }).content;

    expect(actual).toBe(expected);
  });
});
