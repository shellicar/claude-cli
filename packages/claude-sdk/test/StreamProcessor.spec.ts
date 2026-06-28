import type { BetaMessage, BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { ApiStreamError } from '../src/private/http/errors.js';
import { StreamProcessor } from '../src/private/StreamProcessor.js';
import { makeRawStream, makeThrowingStream, wrapWithMessageEnvelope } from './helpers.js';

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

// StreamProcessor injects ILogger via @dependsOn, so build it through a real
// container with a logger fake rather than constructing it bare (which leaves
// the injected field undefined).
function buildStreamProcessor(): StreamProcessor {
  const services = createServiceCollection();
  services.register(ILogger).to(ILogger, () => new NoopLogger());
  services.register(StreamProcessor).to(StreamProcessor);
  return services.buildProvider().resolve(StreamProcessor);
}

// ---------------------------------------------------------------------------
// Fixtures (raw stream events — the owned boundary)
// ---------------------------------------------------------------------------

function textStream(text: string): BetaRawMessageStreamEvent[] {
  return wrapWithMessageEnvelope([
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: null } } as BetaRawMessageStreamEvent,
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } as BetaRawMessageStreamEvent,
    { type: 'content_block_stop', index: 0 } as BetaRawMessageStreamEvent,
  ]);
}

const toolUseStart: BetaRawMessageStreamEvent = { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_01', name: 'ReadFile', input: {} } } as BetaRawMessageStreamEvent;
const inputJsonDelta1: BetaRawMessageStreamEvent = { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } } as BetaRawMessageStreamEvent;
const inputJsonDelta2: BetaRawMessageStreamEvent = { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"/foo.ts"}' } } as BetaRawMessageStreamEvent;
const toolUseStop: BetaRawMessageStreamEvent = { type: 'content_block_stop', index: 1 } as BetaRawMessageStreamEvent;

// A text block then a tool_use block, ending on stop_reason tool_use.
const textThenToolStream: BetaRawMessageStreamEvent[] = [
  { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as unknown as BetaRawMessageStreamEvent,
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: null } } as BetaRawMessageStreamEvent,
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reading.' } } as BetaRawMessageStreamEvent,
  { type: 'content_block_stop', index: 0 } as BetaRawMessageStreamEvent,
  toolUseStart,
  inputJsonDelta1,
  inputJsonDelta2,
  toolUseStop,
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 9 } } as BetaRawMessageStreamEvent,
  { type: 'message_stop' } as BetaRawMessageStreamEvent,
];

// ---------------------------------------------------------------------------
// Assembly and result
// ---------------------------------------------------------------------------

describe('StreamProcessor — assembly and result', () => {
  it('returns the assembled blocks in order for a text + tool stream', async () => {
    const expected = ['text', 'tool_use'];
    const result = await buildStreamProcessor().process(makeRawStream(textThenToolStream));
    const actual = result.blocks.map((b) => b.type);
    expect(actual).toEqual(expected);
  });

  it('parses the streamed tool_use input into the result block', async () => {
    const expected = { path: '/foo.ts' };
    const result = await buildStreamProcessor().process(makeRawStream(textThenToolStream));
    const toolBlock = result.blocks.find((b) => b.type === 'tool_use') as { type: 'tool_use'; input: Record<string, unknown> } | undefined;
    const actual = toolBlock?.input;
    expect(actual).toEqual(expected);
  });

  it('reports the stop reason from the message_delta', async () => {
    const expected = 'tool_use';
    const result = await buildStreamProcessor().process(makeRawStream(textThenToolStream));
    const actual = result.stopReason;
    expect(actual).toBe(expected);
  });

  it('reports the output token usage from the assembled message', async () => {
    const expected = 9;
    const result = await buildStreamProcessor().process(makeRawStream(textThenToolStream));
    const actual = result.usage.outputTokens;
    expect(actual).toBe(expected);
  });

  it('emits the consumer events in order for a text + tool stream', async () => {
    const expected = ['message_start', 'message_text', 'tool_use_start', 'tool_use_input_delta', 'tool_use_input_delta', 'tool_use_input_stop', 'message_stop'];
    const processor = buildStreamProcessor();
    const actual: string[] = [];
    processor.on('message_start', () => actual.push('message_start'));
    processor.on('message_text', () => actual.push('message_text'));
    processor.on('tool_use_start', () => actual.push('tool_use_start'));
    processor.on('tool_use_input_delta', () => actual.push('tool_use_input_delta'));
    processor.on('tool_use_input_stop', () => actual.push('tool_use_input_stop'));
    processor.on('message_stop', () => actual.push('message_stop'));
    await processor.process(makeRawStream(textThenToolStream));
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// final_message and error propagation (§9)
// ---------------------------------------------------------------------------

describe('StreamProcessor — final message', () => {
  it('emits final_message exactly once', async () => {
    const processor = buildStreamProcessor();
    let count = 0;
    processor.on('final_message', () => {
      count++;
    });
    await processor.process(makeRawStream(textStream('hi')));
    const expected = 1;
    const actual = count;
    expect(actual).toBe(expected);
  });

  it('emits final_message carrying the assembled message content', async () => {
    const processor = buildStreamProcessor();
    let message: BetaMessage | undefined;
    processor.on('final_message', (msg) => {
      message = msg;
    });
    await processor.process(makeRawStream(textStream('hello')));
    const actual = (message?.content[0] as { text: string } | undefined)?.text;
    expect(actual).toBe('hello');
  });

  it('propagates a thrown mid-stream error out of process()', async () => {
    const processor = buildStreamProcessor();
    const stream = makeThrowingStream(wrapWithMessageEnvelope([]), new ApiStreamError('overloaded_error', {}));
    const actual = processor.process(stream);
    await expect(actual).rejects.toBeInstanceOf(ApiStreamError);
  });
});

// ---------------------------------------------------------------------------
// Long-lived instance: one instance, many streams, subscribed once
// ---------------------------------------------------------------------------

describe('StreamProcessor — long-lived instance', () => {
  it('processes two streams on the same instance without leaking state', async () => {
    const processor = buildStreamProcessor();
    const first = await processor.process(makeRawStream(textStream('first')));
    const second = await processor.process(makeRawStream(textStream('second')));
    const actual = [(first.blocks[0] as { text: string }).text, (second.blocks[0] as { text: string }).text];
    expect(actual).toEqual(['first', 'second']);
  });

  it('fires `.on(...)` subscribers for every stream, subscribed once', async () => {
    const processor = buildStreamProcessor();
    const actual: string[] = [];
    processor.on('message_text', (text) => actual.push(text));
    await processor.process(makeRawStream(textStream('one')));
    await processor.process(makeRawStream(textStream('two')));
    await processor.process(makeRawStream(textStream('three')));
    expect(actual).toEqual(['one', 'two', 'three']);
  });
});

// ---------------------------------------------------------------------------
// Server tool use: server_tool_use + result blocks preserved and emitted
// ---------------------------------------------------------------------------

describe('StreamProcessor — server tool use', () => {
  const serverToolUseStart: BetaRawMessageStreamEvent = { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_01', name: 'web_search', input: {} } } as unknown as BetaRawMessageStreamEvent;
  const serverToolUseStop: BetaRawMessageStreamEvent = { type: 'content_block_stop', index: 0 } as BetaRawMessageStreamEvent;
  const webSearchResultStart: BetaRawMessageStreamEvent = { type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_01', content: [] } } as unknown as BetaRawMessageStreamEvent;
  const webSearchResultStop: BetaRawMessageStreamEvent = { type: 'content_block_stop', index: 1 } as BetaRawMessageStreamEvent;

  it('preserves server_tool_use and result blocks in the assembled result', async () => {
    const expected = ['server_tool_use', 'web_search_tool_result'];
    const result = await buildStreamProcessor().process(makeRawStream(wrapWithMessageEnvelope([serverToolUseStart, serverToolUseStop, webSearchResultStart, webSearchResultStop])));
    const actual = result.blocks.map((b) => b.type);
    expect(actual).toEqual(expected);
  });

  it('emits server_tool_use with the id and name when the block completes', async () => {
    const processor = buildStreamProcessor();
    const actual: [string, string][] = [];
    processor.on('server_tool_use', (id, name) => actual.push([id, name]));
    await processor.process(makeRawStream(wrapWithMessageEnvelope([serverToolUseStart, serverToolUseStop])));
    const expected: [string, string][] = [['srvtoolu_01', 'web_search']];
    expect(actual).toEqual(expected);
  });

  it('emits server_tool_result with the id and name when the result block completes', async () => {
    const processor = buildStreamProcessor();
    const actual: [string, string][] = [];
    processor.on('server_tool_result', (id, name) => actual.push([id, name]));
    await processor.process(makeRawStream(wrapWithMessageEnvelope([webSearchResultStart, webSearchResultStop])));
    const expected: [string, string][] = [['srvtoolu_01', 'web_search']];
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Tool input streaming: tool_use_start, input deltas, parsed stop
// ---------------------------------------------------------------------------

describe('StreamProcessor — tool input streaming', () => {
  const start: BetaRawMessageStreamEvent = { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_01', name: 'ReadFile', input: {} } } as BetaRawMessageStreamEvent;
  const stop: BetaRawMessageStreamEvent = { type: 'content_block_stop', index: 0 } as BetaRawMessageStreamEvent;
  const delta1: BetaRawMessageStreamEvent = { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":' } } as BetaRawMessageStreamEvent;
  const delta2: BetaRawMessageStreamEvent = { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"/foo.ts"}' } } as BetaRawMessageStreamEvent;

  it('emits tool_use_start with the id and name at content_block_start', async () => {
    const processor = buildStreamProcessor();
    const actual: [string, string][] = [];
    processor.on('tool_use_start', (id, name) => actual.push([id, name]));
    await processor.process(makeRawStream(wrapWithMessageEnvelope([start, stop])));
    const expected: [string, string][] = [['toolu_01', 'ReadFile']];
    expect(actual).toEqual(expected);
  });

  it('emits tool_use_input_delta for each streamed JSON fragment', async () => {
    const processor = buildStreamProcessor();
    const actual: [string, string][] = [];
    processor.on('tool_use_input_delta', (id, partial) => actual.push([id, partial]));
    await processor.process(makeRawStream(wrapWithMessageEnvelope([start, delta1, delta2, stop])));
    const expected: [string, string][] = [
      ['toolu_01', '{"path":'],
      ['toolu_01', '"/foo.ts"}'],
    ];
    expect(actual).toEqual(expected);
  });

  it('emits tool_use_input_stop with the parsed input when the block completes', async () => {
    const processor = buildStreamProcessor();
    const actual: [string, Record<string, unknown>][] = [];
    processor.on('tool_use_input_stop', (id, input) => actual.push([id, input]));
    await processor.process(makeRawStream(wrapWithMessageEnvelope([start, delta1, delta2, stop])));
    const expected: [string, Record<string, unknown>][] = [['toolu_01', { path: '/foo.ts' }]];
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Compaction summary accumulation (required, beyond §9). The old streaming
// layer accumulated compaction_delta text so the assembled compaction block
// surfaced its summary; the rewrite must preserve that. Restored from the
// previous run's dropped compaction-content tests, plus a multi-delta pin.
// ---------------------------------------------------------------------------

describe('StreamProcessor — compaction', () => {
  const startCompaction: BetaRawMessageStreamEvent = { type: 'content_block_start', index: 0, content_block: { type: 'compaction', content: null, encrypted_content: null } } as unknown as BetaRawMessageStreamEvent;
  const stopCompaction: BetaRawMessageStreamEvent = { type: 'content_block_stop', index: 0 } as BetaRawMessageStreamEvent;
  function deltaCompaction(content: string): BetaRawMessageStreamEvent {
    return { type: 'content_block_delta', index: 0, delta: { type: 'compaction_delta', content, encrypted_content: null } } as unknown as BetaRawMessageStreamEvent;
  }

  it('surfaces the compaction summary in the assembled block', async () => {
    const result = await buildStreamProcessor().process(makeRawStream(wrapWithMessageEnvelope([startCompaction, deltaCompaction('First summary'), stopCompaction])));
    const block = result.blocks.find((b) => b.type === 'compaction') as { type: 'compaction'; content: string } | undefined;
    const actual = block?.content;
    expect(actual).toBe('First summary');
  });

  it('emits compaction_complete with the accumulated summary text', async () => {
    const processor = buildStreamProcessor();
    let emitted: string | undefined;
    processor.on('compaction_complete', (summary) => {
      emitted = summary;
    });
    await processor.process(makeRawStream(wrapWithMessageEnvelope([startCompaction, deltaCompaction('First summary'), stopCompaction])));
    const actual = emitted;
    expect(actual).toBe('First summary');
  });

  it('concatenates multiple compaction_delta fragments into the summary', async () => {
    const result = await buildStreamProcessor().process(makeRawStream(wrapWithMessageEnvelope([startCompaction, deltaCompaction('First '), deltaCompaction('summary'), stopCompaction])));
    const block = result.blocks.find((b) => b.type === 'compaction') as { type: 'compaction'; content: string } | undefined;
    const actual = block?.content;
    expect(actual).toBe('First summary');
  });
});
