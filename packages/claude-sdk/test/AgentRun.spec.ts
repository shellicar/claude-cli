import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import type { BetaContentBlockParam, BetaMessageParam, BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';
import { describe, expect, it } from 'vitest';
import { IAgentChannel, IAgentChannelFactory } from '../src/private/AgentChannel.js';
import { AgentRun } from '../src/private/AgentRun.js';
import { ConversationStore } from '../src/private/ConversationStore.js';
import { IMessageStreamer } from '../src/private/MessageStreamer.js';
import type { ConsumerMessage, RunAgentQuery, SdkMessage } from '../src/public/types.js';

// ---------------------------------------------------------------------------
// Stream helpers
// ---------------------------------------------------------------------------

async function* makeEndTurnStream(text: string): AsyncIterable<BetaRawMessageStreamEvent> {
  yield { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as BetaRawMessageStreamEvent;
  yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } as BetaRawMessageStreamEvent;
  yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } as BetaRawMessageStreamEvent;
  yield { type: 'content_block_stop', index: 0 } as BetaRawMessageStreamEvent;
  yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } } as BetaRawMessageStreamEvent;
  yield { type: 'message_stop' } as BetaRawMessageStreamEvent;
}

async function* makeToolUseStream(toolId: string, toolName: string): AsyncIterable<BetaRawMessageStreamEvent> {
  yield { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as BetaRawMessageStreamEvent;
  yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: toolId, name: toolName, input: {} } } as BetaRawMessageStreamEvent;
  yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } } as BetaRawMessageStreamEvent;
  yield { type: 'content_block_stop', index: 0 } as BetaRawMessageStreamEvent;
  yield { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } } as BetaRawMessageStreamEvent;
  yield { type: 'message_stop' } as BetaRawMessageStreamEvent;
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeMessageStreamer extends IMessageStreamer {
  public readonly calls: BetaMessageStreamParams[] = [];
  readonly #responses: Array<AsyncIterable<BetaRawMessageStreamEvent>>;

  public constructor(responses: Array<AsyncIterable<BetaRawMessageStreamEvent>>) {
    super();
    this.#responses = [...responses];
  }

  public stream(body: BetaMessageStreamParams, _options: Anthropic.RequestOptions): AsyncIterable<BetaRawMessageStreamEvent> {
    this.calls.push(body);
    const next = this.#responses.shift();
    if (next == null) {
      throw new Error('FakeMessageStreamer: no more scripted responses');
    }
    return next;
  }
}

class FakeAgentChannel extends IAgentChannel {
  public readonly consumerPort: MessagePort;
  public readonly messages: SdkMessage[] = [];

  public constructor() {
    super();
    this.consumerPort = new MessageChannel().port2;
  }

  public send(msg: SdkMessage): void {
    this.messages.push(msg);
  }
  public close(): void {}
}

class FakeAgentChannelFactory extends IAgentChannelFactory {
  public channel!: FakeAgentChannel;

  public create(_onMessage: (msg: ConsumerMessage) => void): IAgentChannel {
    this.channel = new FakeAgentChannel();
    return this.channel;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOptions(overrides: Partial<RunAgentQuery> = {}): RunAgentQuery {
  return {
    model: 'claude-opus-4-5' as RunAgentQuery['model'],
    maxTokens: 1024,
    messages: ['hello'],
    tools: [],
    ...overrides,
  };
}

const getContentBlock = (msg: BetaMessageParam[]): BetaContentBlockParam | null => {
  const last = msg.at(-1)?.content.at(-1);
  if (typeof last === 'object') {
    return last;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentRun — systemReminder', () => {
  describe('single-call turn', () => {
    it('injects reminder as last block of the user message', async () => {
      const streamer = new FakeMessageStreamer([makeEndTurnStream('done')]);
      const run = new AgentRun(streamer, new FakeAgentChannelFactory(), undefined, makeOptions({ systemReminder: 'stay focused' }), new ConversationStore());
      await run.execute();

      const actual = getContentBlock(streamer.calls[0]?.messages);
      const expected = { type: 'text', text: '<system-reminder>\nstay focused\n</system-reminder>' };
      expect(actual).toEqual(expected);
    });
  });

  describe('tool-use continuation', () => {
    it('makes exactly two API calls', async () => {
      const streamer = new FakeMessageStreamer([makeToolUseStream('tu_1', 'SomeTool'), makeEndTurnStream('done')]);
      const run = new AgentRun(streamer, new FakeAgentChannelFactory(), undefined, makeOptions({ systemReminder: 'stay focused' }), new ConversationStore());
      await run.execute();

      expect(streamer.calls).toHaveLength(2);
    });

    it('second call ends with a tool_result block', async () => {
      const streamer = new FakeMessageStreamer([makeToolUseStream('tu_1', 'SomeTool'), makeEndTurnStream('done')]);
      const run = new AgentRun(streamer, new FakeAgentChannelFactory(), undefined, makeOptions({ systemReminder: 'stay focused' }), new ConversationStore());
      await run.execute();

      const actual = getContentBlock(streamer.calls[1].messages)?.type;
      expect(actual).toBe('tool_result');
    });
  });
});

// ---------------------------------------------------------------------------
// cachedReminders injection
// ---------------------------------------------------------------------------

describe('AgentRun — cachedReminders', () => {
  it('injects reminder as first block of the first user message when history is empty', async () => {
    const streamer = new FakeMessageStreamer([makeEndTurnStream('done')]);
    const run = new AgentRun(streamer, new FakeAgentChannelFactory(), undefined, makeOptions({ cachedReminders: ['be careful'] }), new ConversationStore());
    await run.execute();

    const firstMessage = streamer.calls[0]?.messages[0];
    const content = firstMessage?.content;
    expect(Array.isArray(content)).toBe(true);
    const firstBlock = Array.isArray(content) ? content[0] : null;
    expect(firstBlock).toMatchObject({ type: 'text', text: expect.stringContaining('<system-reminder>') });
  });

  it('does not inject reminders when the conversation already has messages', async () => {
    const streamer = new FakeMessageStreamer([makeEndTurnStream('done')]);
    const history = new ConversationStore();
    history.push({ role: 'user', content: 'earlier message' });
    history.push({ role: 'assistant', content: [{ type: 'text', text: 'earlier response' }] });
    const run = new AgentRun(streamer, new FakeAgentChannelFactory(), undefined, makeOptions({ cachedReminders: ['be careful'] }), history);
    await run.execute();

    const lastMessage = streamer.calls[0]?.messages.at(-1);
    const blocks = Array.isArray(lastMessage?.content) ? lastMessage.content : [];
    const hasReminderBlock = blocks.some((b) => typeof b === 'object' && 'text' in b && String(b.text).includes('<system-reminder>'));
    expect(hasReminderBlock).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// query_summary channel messages
// ---------------------------------------------------------------------------

describe('AgentRun — systemReminder in query_summary', () => {
  it('first query_summary carries systemReminder', async () => {
    const streamer = new FakeMessageStreamer([makeEndTurnStream('done')]);
    const factory = new FakeAgentChannelFactory();
    const run = new AgentRun(streamer, factory, undefined, makeOptions({ systemReminder: 'stay focused' }), new ConversationStore());
    await run.execute();

    const summaries = factory.channel.messages.filter((m): m is Extract<SdkMessage, { type: 'query_summary' }> => m.type === 'query_summary');
    expect(summaries[0]?.systemReminder).toBe('stay focused');
  });

  it('second query_summary does not carry systemReminder', async () => {
    const streamer = new FakeMessageStreamer([makeToolUseStream('tu_1', 'SomeTool'), makeEndTurnStream('done')]);
    const factory = new FakeAgentChannelFactory();
    const run = new AgentRun(streamer, factory, undefined, makeOptions({ systemReminder: 'stay focused' }), new ConversationStore());
    await run.execute();

    const summaries = factory.channel.messages.filter((m): m is Extract<SdkMessage, { type: 'query_summary' }> => m.type === 'query_summary');
    expect(summaries[1]?.systemReminder).toBeUndefined();
  });
});
