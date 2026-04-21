import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';
import { describe, expect, it } from 'vitest';
import { Conversation } from '../src/private/Conversation.js';
import { IMessageStreamer } from '../src/private/MessageStreamer.js';
import { StreamProcessor } from '../src/private/StreamProcessor.js';
import { TurnRunner } from '../src/private/TurnRunner.js';
import type { DurableConfig } from '../src/public/types.js';

// ---------------------------------------------------------------------------
// Stream helpers
// ---------------------------------------------------------------------------

async function* makeTextStream(text: string): AsyncIterable<BetaRawMessageStreamEvent> {
  yield { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as BetaRawMessageStreamEvent;
  yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } as BetaRawMessageStreamEvent;
  yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } as BetaRawMessageStreamEvent;
  yield { type: 'content_block_stop', index: 0 } as BetaRawMessageStreamEvent;
  yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } } as BetaRawMessageStreamEvent;
  yield { type: 'message_stop' } as BetaRawMessageStreamEvent;
}

async function* makeEmptyStream(): AsyncIterable<BetaRawMessageStreamEvent> {
  yield { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as BetaRawMessageStreamEvent;
  yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } } as BetaRawMessageStreamEvent;
  yield { type: 'message_stop' } as BetaRawMessageStreamEvent;
}

async function* makeServerToolStream(): AsyncIterable<BetaRawMessageStreamEvent> {
  yield { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as BetaRawMessageStreamEvent;
  yield { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_01', name: 'web_search', input: {} } as unknown as Anthropic.Beta.Messages.BetaContentBlock } as BetaRawMessageStreamEvent;
  yield { type: 'content_block_stop', index: 0 } as BetaRawMessageStreamEvent;
  yield { type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_01', content: [] } as unknown as Anthropic.Beta.Messages.BetaContentBlock } as BetaRawMessageStreamEvent;
  yield { type: 'content_block_stop', index: 1 } as BetaRawMessageStreamEvent;
  yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } } as BetaRawMessageStreamEvent;
  yield { type: 'message_stop' } as BetaRawMessageStreamEvent;
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeMessageStreamer extends IMessageStreamer {
  public readonly calls: { body: BetaMessageStreamParams; options: Anthropic.RequestOptions }[] = [];
  readonly #responses: Array<AsyncIterable<BetaRawMessageStreamEvent>>;

  public constructor(responses: Array<AsyncIterable<BetaRawMessageStreamEvent>>) {
    super();
    this.#responses = [...responses];
  }

  public stream(body: BetaMessageStreamParams, options: Anthropic.RequestOptions): AsyncIterable<BetaRawMessageStreamEvent> {
    this.calls.push({ body, options });
    const next = this.#responses.shift();
    if (next == null) {
      throw new Error('FakeMessageStreamer: no more scripted responses');
    }
    return next;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDurableConfig(overrides: Partial<DurableConfig> = {}): DurableConfig {
  return {
    model: 'claude-opus-4-5' as DurableConfig['model'],
    maxTokens: 1024,
    tools: [],
    ...overrides,
  };
}

function makeConvWithUser(text: string): Conversation {
  const conv = new Conversation();
  conv.push({ role: 'user', content: text });
  return conv;
}

// ---------------------------------------------------------------------------
// Single turn correctness — one run mirrors the expected QueryRunner behaviour
// for a single API cycle.
// ---------------------------------------------------------------------------

describe('TurnRunner — single turn correctness', () => {
  it('runs one turn and pushes the assembled assistant message to the conversation', async () => {
    const streamer = new FakeMessageStreamer([makeTextStream('hello')]);
    const processor = new StreamProcessor();
    const runner = new TurnRunner(streamer, processor);
    const conv = makeConvWithUser('hi');

    const abort = new AbortController();
    const result = await runner.run(conv, makeDurableConfig(), { abortSignal: abort.signal });

    expect(result.stopReason).toBe('end_turn');
    const last = conv.messages.at(-1);
    expect(last?.role).toBe('assistant');
    expect(last?.content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('does not push an assistant message when the stream yields no content blocks', async () => {
    const streamer = new FakeMessageStreamer([makeEmptyStream()]);
    const processor = new StreamProcessor();
    const runner = new TurnRunner(streamer, processor);
    const conv = makeConvWithUser('hi');
    const before = conv.messages.length;

    const abort = new AbortController();
    const result = await runner.run(conv, makeDurableConfig(), { abortSignal: abort.signal });

    expect(result.blocks).toEqual([]);
    expect(conv.messages.length).toBe(before);
  });

  it('injects the per-turn systemReminder into the last user message of the request body', async () => {
    const streamer = new FakeMessageStreamer([makeTextStream('ok')]);
    const processor = new StreamProcessor();
    const runner = new TurnRunner(streamer, processor);
    const conv = makeConvWithUser('hi');

    const abort = new AbortController();
    await runner.run(conv, makeDurableConfig(), { abortSignal: abort.signal, systemReminder: 'stay focused' });

    const body = streamer.calls[0]?.body;
    const lastMsg = body?.messages.at(-1);
    const content = Array.isArray(lastMsg?.content) ? lastMsg.content : [];
    const reminderBlock = content.find((b) => typeof b === 'object' && 'text' in b && typeof b.text === 'string' && b.text.includes('<system-reminder>'));
    expect(reminderBlock).toBeDefined();
  });

  it('passes the per-turn abort signal through to the streamer request options', async () => {
    const streamer = new FakeMessageStreamer([makeTextStream('ok')]);
    const processor = new StreamProcessor();
    const runner = new TurnRunner(streamer, processor);
    const conv = makeConvWithUser('hi');

    const abort = new AbortController();
    await runner.run(conv, makeDurableConfig(), { abortSignal: abort.signal });

    expect(streamer.calls[0]?.options.signal).toBe(abort.signal);
  });
});

// ---------------------------------------------------------------------------
// Long-lived instance — the point of the refactor. Same runner reused across
// turns, stream processor subscriptions set once at setup fire for every turn.
// ---------------------------------------------------------------------------

describe('TurnRunner — long-lived instance', () => {
  it('processes multiple turns on the same instance with subscriptions set once at setup', async () => {
    const streamer = new FakeMessageStreamer([makeTextStream('first'), makeTextStream('second')]);
    const processor = new StreamProcessor();
    const received: string[] = [];
    // Subscribe ONCE before any turn runs. The whole refactor hinges on this
    // staying subscribed across turns without the runner touching it.
    processor.on('message_text', (text) => received.push(text));
    const runner = new TurnRunner(streamer, processor);
    const conv = makeConvWithUser('hi');

    const abort = new AbortController();
    await runner.run(conv, makeDurableConfig(), { abortSignal: abort.signal });
    conv.push({ role: 'user', content: 'follow up' });
    await runner.run(conv, makeDurableConfig(), { abortSignal: abort.signal });

    expect(streamer.calls).toHaveLength(2);
    expect(received).toEqual(['first', 'second']);
  });
});

// ---------------------------------------------------------------------------
// Server tool block preservation: server_tool_use and web_search_tool_result
// blocks must appear in the assistant message pushed to the conversation.
// ---------------------------------------------------------------------------

describe('TurnRunner — server tool block preservation', () => {
  it('assistant message content includes server_tool_use and web_search_tool_result blocks', async () => {
    const streamer = new FakeMessageStreamer([makeServerToolStream()]);
    const processor = new StreamProcessor();
    const runner = new TurnRunner(streamer, processor);
    const conv = makeConvWithUser('search for something');

    const abort = new AbortController();
    await runner.run(conv, makeDurableConfig(), { abortSignal: abort.signal });

    const last = conv.messages.at(-1);
    const expected = ['server_tool_use', 'web_search_tool_result'];
    const actual = (last?.content as Array<{ type: string }> | undefined)?.map((b) => b.type);
    expect(actual).toEqual(expected);
  });
});
