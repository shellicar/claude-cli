import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStream } from '@anthropic-ai/sdk/lib/BetaMessageStream.mjs';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApprovalCoordinator } from '../src/private/ApprovalCoordinator.js';
import type { IPublisher } from '../src/private/ControlChannel.js';
import { Conversation } from '../src/private/Conversation.js';
import { IMessageStreamer } from '../src/private/MessageStreamer.js';
import { QueryRunner } from '../src/private/QueryRunner.js';
import { StreamProcessor } from '../src/private/StreamProcessor.js';
import { ToolRegistry } from '../src/private/ToolRegistry.js';
import { TurnRunner } from '../src/private/TurnRunner.js';
import type { AnyToolDefinition, DocumentBlock, DurableConfig, PerQueryInput, SdkMessage, TextBlock, ToolResultBlock } from '../src/public/types.js';
import { makeBetaStream } from './helpers.js';

// ---------------------------------------------------------------------------
// Stream helpers (the QueryRunner
// tests exercise the real TurnRunner + real StreamProcessor with scripted
// HTTP responses).
// ---------------------------------------------------------------------------

function makeEndTurnStream(text: string): BetaRawMessageStreamEvent[] {
  return [
    { type: 'message_start', message: { content: [], usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as unknown as BetaRawMessageStreamEvent,
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } as BetaRawMessageStreamEvent,
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } as BetaRawMessageStreamEvent,
    { type: 'content_block_stop', index: 0 } as BetaRawMessageStreamEvent,
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } } as BetaRawMessageStreamEvent,
    { type: 'message_stop' } as BetaRawMessageStreamEvent,
  ];
}

function makeToolUseStream(toolId: string, toolName: string, input: Record<string, unknown> = {}): BetaRawMessageStreamEvent[] {
  return [
    { type: 'message_start', message: { content: [], usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as unknown as BetaRawMessageStreamEvent,
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: toolId, name: toolName, input: {} } } as BetaRawMessageStreamEvent,
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } } as BetaRawMessageStreamEvent,
    { type: 'content_block_stop', index: 0 } as BetaRawMessageStreamEvent,
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } } as BetaRawMessageStreamEvent,
    { type: 'message_stop' } as BetaRawMessageStreamEvent,
  ];
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeMessageStreamer extends IMessageStreamer {
  public readonly calls: { body: BetaMessageStreamParams; options: Anthropic.RequestOptions }[] = [];
  readonly #responses: Array<BetaRawMessageStreamEvent[]>;

  public constructor(responses: Array<BetaRawMessageStreamEvent[]>) {
    super();
    this.#responses = [...responses];
  }

  public stream(body: BetaMessageStreamParams, options: Anthropic.RequestOptions): BetaMessageStream {
    this.calls.push({ body, options });
    const next = this.#responses.shift();
    if (next == null) {
      throw new Error('FakeMessageStreamer: no more scripted responses');
    }
    return makeBetaStream(next);
  }
}

class FakeSdkPublisher implements IPublisher<SdkMessage> {
  public readonly messages: SdkMessage[] = [];
  public closeCount = 0;

  public send(msg: SdkMessage): void {
    this.messages.push(msg);
  }

  public close(): void {
    this.closeCount++;
  }

  public drain(): Promise<void> {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(name: string, handler: (input: { value: string }) => Promise<unknown>): AnyToolDefinition {
  const schema = z.object({ value: z.string() });
  return {
    name,
    description: `Tool ${name}`,
    input_schema: schema,
    output_schema: z.unknown(),
    input_examples: [{ value: 'example' }],
    handler: (async (input: { value: string }) => ({
      textContent: await handler(input),
    })) as AnyToolDefinition['handler'],
  };
}

function makeDurable(overrides: Partial<DurableConfig> = {}): DurableConfig {
  return {
    model: 'claude-opus-4-5' as DurableConfig['model'],
    maxTokens: 1024,
    tools: [],
    ...overrides,
  };
}

function makeInput(overrides: Partial<PerQueryInput> = {}): PerQueryInput {
  return {
    messages: ['hi'],
    abortController: new AbortController(),
    ...overrides,
  };
}

type Wiring = {
  streamer: FakeMessageStreamer;
  processor: StreamProcessor;
  turnRunner: TurnRunner;
  registry: ToolRegistry;
  approval: ApprovalCoordinator;
  channel: FakeSdkPublisher;
  conversation: Conversation;
  queryRunner: QueryRunner;
};

function makeWiring(responses: Array<BetaRawMessageStreamEvent[]>, tools: AnyToolDefinition[] = [], durableOverrides: Partial<DurableConfig> = {}, conversation?: Conversation): Wiring {
  const streamer = new FakeMessageStreamer(responses);
  const processor = new StreamProcessor();
  const turnRunner = new TurnRunner(streamer, processor);
  const registry = new ToolRegistry(tools);
  const approval = new ApprovalCoordinator();
  const channel = new FakeSdkPublisher();
  const conv = conversation ?? new Conversation();
  const durable = makeDurable({ tools, ...durableOverrides });
  const queryRunner = new QueryRunner(turnRunner, conv, registry, approval, channel, durable);
  return { streamer, processor, turnRunner, registry, approval, channel, conversation: conv, queryRunner };
}

function getToolResult(w: Wiring, callIndex: number): ToolResultBlock | undefined {
  const body = w.streamer.calls[callIndex]?.body;
  const content = body?.messages.at(-1)?.content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  return content.find((b) => b.type === 'tool_result') as ToolResultBlock | undefined;
}

function getTextBlock(toolResult: ToolResultBlock | undefined): TextBlock | undefined {
  const content = toolResult?.content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  return content.find((b): b is { type: 'text'; text: string } => b.type === 'text');
}

function getDocumentBlock(toolResult: ToolResultBlock | undefined): DocumentBlock | undefined {
  const content = toolResult?.content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  return content.find((b): b is DocumentBlock => b.type === 'document');
}

// ---------------------------------------------------------------------------
// Single-turn terminal exit
// ---------------------------------------------------------------------------

describe('QueryRunner — single turn terminal exit', () => {
  it('runs one turn, pushes user + assistant messages, sends done on end_turn', async () => {
    const w = makeWiring([makeEndTurnStream('hello')]);
    await w.queryRunner.run(makeInput({ messages: ['hi'] }));

    expect(w.streamer.calls).toHaveLength(1);
    // Conversation has the user ask and the assembled assistant reply.
    const roles = w.conversation.messages.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant']);
    // done channel send is the last event before the loop exits.
    const done = w.channel.messages.find((m) => m.type === 'done');
    expect(done).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('emits query_summary and message_usage on the channel per turn', async () => {
    const w = makeWiring([makeEndTurnStream('hello')]);
    await w.queryRunner.run(makeInput());

    const querySummary = w.channel.messages.find((m) => m.type === 'query_summary');
    const messageUsage = w.channel.messages.find((m) => m.type === 'message_usage');
    expect(querySummary).toBeDefined();
    expect(messageUsage).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tool-use loop
// ---------------------------------------------------------------------------

describe('QueryRunner — tool-use loop', () => {
  it('runs tool on tool_use, pushes tool_result, continues to terminal turn', async () => {
    let handlerCalledWith: { value: string } | undefined;
    const tool = makeTool('echo', async (input) => {
      handlerCalledWith = input;
      return `got: ${input.value}`;
    });
    const w = makeWiring([makeToolUseStream('tu_1', 'echo', { value: 'hi' }), makeEndTurnStream('done')], [tool]);
    await w.queryRunner.run(makeInput({ messages: ['do it'] }));

    expect(w.streamer.calls).toHaveLength(2);
    expect(handlerCalledWith).toEqual({ value: 'hi' });

    // Second request must include the tool_result as a user message.
    const secondBody = w.streamer.calls[1]?.body;
    const lastMsg = secondBody?.messages.at(-1);
    expect(lastMsg?.role).toBe('user');
    const lastContent = Array.isArray(lastMsg?.content) ? lastMsg.content : [];
    const toolResult = lastContent.find((b): b is Anthropic.Beta.Messages.BetaToolResultBlockParam => typeof b === 'object' && 'type' in b && b.type === 'tool_result');
    expect(toolResult).toBeDefined();
    expect(toolResult?.tool_use_id).toBe('tu_1');
    expect(toolResult?.content).toContainEqual({ type: 'text', text: 'got: hi' });
  });

  it('tool not_found: silent on channel, is_error tool_result (Decision 3)', async () => {
    const w = makeWiring([makeToolUseStream('tu_1', 'missing', { value: 'hi' }), makeEndTurnStream('done')], []);
    await w.queryRunner.run(makeInput());

    // No tool_error channel message for the not_found case.
    const toolErrors = w.channel.messages.filter((m) => m.type === 'tool_error');
    expect(toolErrors).toHaveLength(0);

    // The tool_result sent back to the model is an is_error block.
    const toolResult = getToolResult(w, 1);
    expect(toolResult?.is_error).toBe(true);
    expect(getTextBlock(toolResult)?.text).toContain('Tool not found');
  });

  it('tool invalid_input: sends tool_error on channel, is_error tool_result (Decision 3)', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    // Model supplies a wrong-shaped input (missing `value`). The registry's
    // safeParse rejects it and QueryRunner routes to the channel.
    const w = makeWiring([makeToolUseStream('tu_1', 'echo', { wrong: 'field' }), makeEndTurnStream('done')], [tool]);
    await w.queryRunner.run(makeInput());

    const toolErrors = w.channel.messages.filter((m) => m.type === 'tool_error');
    expect(toolErrors).toHaveLength(1);
    expect(toolErrors[0]).toMatchObject({ type: 'tool_error', name: 'echo' });
  });

  it('tool handler_error: sends tool_error on channel and is_error tool_result', async () => {
    const tool = makeTool('boom', async () => {
      throw new Error('kaboom');
    });
    const w = makeWiring([makeToolUseStream('tu_1', 'boom', { value: 'hi' }), makeEndTurnStream('done')], [tool]);
    await w.queryRunner.run(makeInput());

    const toolErrors = w.channel.messages.filter((m) => m.type === 'tool_error');
    expect(toolErrors).toHaveLength(1);
    expect(toolErrors[0]).toMatchObject({ type: 'tool_error', name: 'boom', error: 'kaboom' });
  });
});

// ---------------------------------------------------------------------------
// systemReminder lifecycle (first-turn-only)
// ---------------------------------------------------------------------------

describe('QueryRunner — systemReminder', () => {
  it('injects reminder into the first request only, undefined on the second', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const w = makeWiring([makeToolUseStream('tu_1', 'echo', { value: 'hi' }), makeEndTurnStream('done')], [tool]);
    await w.queryRunner.run(makeInput({ messages: ['do it'], systemReminder: 'stay focused' }));

    // First turn's request body should carry the reminder on the last user message.
    const firstBody = w.streamer.calls[0]?.body;
    const firstLastContent = Array.isArray(firstBody?.messages.at(-1)?.content) ? (firstBody?.messages.at(-1)?.content as Anthropic.Beta.Messages.BetaContentBlockParam[]) : [];
    const firstReminder = firstLastContent.find((b) => typeof b === 'object' && 'text' in b && typeof b.text === 'string' && b.text.includes('<system-reminder>'));
    expect(firstReminder).toBeDefined();

    // Second turn must NOT carry the reminder.
    const secondBody = w.streamer.calls[1]?.body;
    const secondLastContent = Array.isArray(secondBody?.messages.at(-1)?.content) ? (secondBody?.messages.at(-1)?.content as Anthropic.Beta.Messages.BetaContentBlockParam[]) : [];
    const secondReminder = secondLastContent.find((b) => typeof b === 'object' && 'text' in b && typeof b.text === 'string' && b.text.includes('<system-reminder>'));
    expect(secondReminder).toBeUndefined();
  });

  it('first query_summary carries systemReminder, second does not', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const w = makeWiring([makeToolUseStream('tu_1', 'echo', { value: 'hi' }), makeEndTurnStream('done')], [tool]);
    await w.queryRunner.run(makeInput({ systemReminder: 'stay focused' }));

    const summaries = w.channel.messages.filter((m): m is Extract<SdkMessage, { type: 'query_summary' }> => m.type === 'query_summary');
    expect(summaries[0]?.systemReminder).toBe('stay focused');
    expect(summaries[1]?.systemReminder).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// cachedReminders injection
// ---------------------------------------------------------------------------

describe('QueryRunner — cachedReminders', () => {
  it('injects cached reminders into the first user message on a fresh conversation', async () => {
    const w = makeWiring([makeEndTurnStream('done')], [], { cachedReminders: ['be careful'] });
    await w.queryRunner.run(makeInput({ messages: ['hello'] }));

    const firstMsg = w.streamer.calls[0]?.body.messages[0];
    const content = Array.isArray(firstMsg?.content) ? firstMsg.content : [];
    const firstBlock = content[0];
    expect(firstBlock).toMatchObject({ type: 'text', text: expect.stringContaining('<system-reminder>') });
  });

  it('does not inject cached reminders when the conversation already has user messages', async () => {
    const existing = new Conversation();
    existing.push({ role: 'user', content: 'earlier' });
    existing.push({ role: 'assistant', content: [{ type: 'text', text: 'earlier response' }] });
    const w = makeWiring([makeEndTurnStream('done')], [], { cachedReminders: ['be careful'] }, existing);
    await w.queryRunner.run(makeInput({ messages: ['hello again'] }));

    // Walk every message sent in the request and verify no block contains the reminder tag.
    const body = w.streamer.calls[0]?.body;
    const hasReminder = body?.messages.some((m) => {
      const blocks = Array.isArray(m.content) ? m.content : [];
      return blocks.some((b) => typeof b === 'object' && 'text' in b && typeof b.text === 'string' && b.text.includes('<system-reminder>'));
    });
    expect(hasReminder).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Approval flow
// ---------------------------------------------------------------------------

describe('QueryRunner — approval', () => {
  it('when approval is required and approved, the tool runs', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const w = makeWiring([makeToolUseStream('tu_1', 'echo', { value: 'hi' }), makeEndTurnStream('done')], [tool], { requireToolApproval: true });

    const runPromise = w.queryRunner.run(makeInput());

    // Wait a microtask so the approval request has been queued, then deliver approval.
    await new Promise((resolve) => setImmediate(resolve));
    const approvalRequest = w.channel.messages.find((m) => m.type === 'tool_approval_request');
    expect(approvalRequest).toBeDefined();
    if (approvalRequest?.type !== 'tool_approval_request') {
      throw new Error('unreachable');
    }
    w.approval.handle({ type: 'tool_approval_response', requestId: approvalRequest.requestId, approved: true });

    await runPromise;

    // Second turn fired, meaning the tool ran.
    expect(w.streamer.calls).toHaveLength(2);
  });

  it('when approval is required and rejected, tool_result carries the rejection reason and the handler is not invoked', async () => {
    let handlerRan = false;
    const tool = makeTool('echo', async (input) => {
      handlerRan = true;
      return `got: ${input.value}`;
    });
    const w = makeWiring([makeToolUseStream('tu_1', 'echo', { value: 'hi' }), makeEndTurnStream('done')], [tool], { requireToolApproval: true });

    const runPromise = w.queryRunner.run(makeInput());

    await new Promise((resolve) => setImmediate(resolve));
    const approvalRequest = w.channel.messages.find((m) => m.type === 'tool_approval_request');
    if (approvalRequest?.type !== 'tool_approval_request') {
      throw new Error('unreachable');
    }
    w.approval.handle({
      type: 'tool_approval_response',
      requestId: approvalRequest.requestId,
      approved: false,
      reason: 'not today',
    });

    await runPromise;

    expect(handlerRan).toBe(false);

    // The second request's user message carries a tool_result with the reason as content.
    const toolResult = getToolResult(w, 1);
    expect(toolResult?.is_error).toBe(true);
    expect(getTextBlock(toolResult)?.text).toBe('not today');
  });
});

// ---------------------------------------------------------------------------
// Long-lived instance and reset
// ---------------------------------------------------------------------------

describe('QueryRunner — long-lived instance', () => {
  it('runs two queries in sequence on the same instance, channel stays open between them', async () => {
    // Share one wiring across two runs. Stream two scripted responses; each
    // run consumes one.
    const w = makeWiring([makeEndTurnStream('first'), makeEndTurnStream('second')]);

    await w.queryRunner.run(makeInput({ messages: ['first'] }));
    await w.queryRunner.run(makeInput({ messages: ['second'] }));

    expect(w.streamer.calls).toHaveLength(2);
    // channel.close() must NOT be called by QueryRunner. The channel is
    // long-lived and owned by the consumer.
    expect(w.channel.closeCount).toBe(0);

    // Conversation accumulates history across both queries.
    const roles = w.conversation.messages.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('reset() clears cancelled from a prior cancelled query so a subsequent run proceeds', async () => {
    const w = makeWiring([makeEndTurnStream('second try')]);
    // Simulate a cancel before the first call runs: set the flag via handle().
    w.approval.handle({ type: 'cancel' });
    expect(w.approval.cancelled).toBe(true);

    // Without reset, the loop would skip entirely. QueryRunner calls reset()
    // at the start of run(), so the subsequent query runs normally.
    await w.queryRunner.run(makeInput({ messages: ['go'] }));

    expect(w.streamer.calls).toHaveLength(1);
    expect(w.approval.cancelled).toBe(false);
  });
});

describe('QueryRunner — tool_result content array for binary outputs', () => {
  it('tool result tool_use_id matches the triggered tool use', async () => {
    const tool = makeTool('readpdf', async () => 'ignored');
    (tool as any).handler = async () => ({
      textContent: { type: 'binary', path: '/doc.pdf', mimeType: 'application/pdf', sizeKb: 5 },
      attachments: [{ type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: 'pdfdata' } }],
    });
    const w = makeWiring([makeToolUseStream('tu_1', 'readpdf', { value: 'x' }), makeEndTurnStream('done')], [tool]);
    await w.queryRunner.run(makeInput({ messages: ['read the pdf'] }));
    const toolResult = getToolResult(w, 1);

    const actual = toolResult?.tool_use_id;
    const expected = 'tu_1';
    expect(actual).toBe(expected);
  });

  it('tool result content is an array for binary tool output', async () => {
    const tool = makeTool('readpdf', async () => 'ignored');
    (tool as any).handler = async () => ({
      textContent: { type: 'binary', path: '/doc.pdf', mimeType: 'application/pdf', sizeKb: 5 },
      attachments: [{ type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: 'pdfdata' } }],
    });
    const w = makeWiring([makeToolUseStream('tu_1', 'readpdf', { value: 'x' }), makeEndTurnStream('done')], [tool]);
    await w.queryRunner.run(makeInput({ messages: ['read the pdf'] }));
    const toolResult = getToolResult(w, 1);

    const actual = Array.isArray(toolResult?.content);
    const expected = true;
    expect(actual).toBe(expected);
  });

  it('tool result text block contains the file path', async () => {
    const tool = makeTool('readpdf', async () => 'ignored');
    (tool as any).handler = async () => ({
      textContent: { type: 'binary', path: '/doc.pdf', mimeType: 'application/pdf', sizeKb: 5 },
      attachments: [{ type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: 'pdfdata' } }],
    });
    const w = makeWiring([makeToolUseStream('tu_1', 'readpdf', { value: 'x' }), makeEndTurnStream('done')], [tool]);
    await w.queryRunner.run(makeInput({ messages: ['read the pdf'] }));
    const toolResult = getToolResult(w, 1);

    const actual = getTextBlock(toolResult)?.text;
    const expected = '/doc.pdf';
    expect(actual).toContain(expected);
  });

  it('document block is present in tool result content array', async () => {
    const tool = makeTool('readpdf', async () => 'ignored');
    (tool as any).handler = async () => ({
      textContent: { type: 'binary', path: '/doc.pdf', mimeType: 'application/pdf', sizeKb: 5 },
      attachments: [{ type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: 'pdfdata' } }],
    });
    const w = makeWiring([makeToolUseStream('tu_1', 'readpdf', { value: 'x' }), makeEndTurnStream('done')], [tool]);
    await w.queryRunner.run(makeInput({ messages: ['read the pdf'] }));
    const toolResult = getToolResult(w, 1);

    const actual = getDocumentBlock(toolResult) !== undefined;
    const expected = true;
    expect(actual).toBe(expected);
  });

  it('document block source type is base64 in tool result content', async () => {
    const tool = makeTool('readpdf', async () => 'ignored');
    (tool as any).handler = async () => ({
      textContent: { type: 'binary', path: '/doc.pdf', mimeType: 'application/pdf', sizeKb: 5 },
      attachments: [{ type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: 'pdfdata' } }],
    });
    const w = makeWiring([makeToolUseStream('tu_1', 'readpdf', { value: 'x' }), makeEndTurnStream('done')], [tool]);
    await w.queryRunner.run(makeInput({ messages: ['read the pdf'] }));
    const toolResult = getToolResult(w, 1);

    const actual = getDocumentBlock(toolResult)?.source.type;
    const expected = 'base64';
    expect(actual).toBe(expected);
  });

  it('document block source media_type is application/pdf in tool result content', async () => {
    const tool = makeTool('readpdf', async () => 'ignored');
    (tool as any).handler = async () => ({
      textContent: { type: 'binary', path: '/doc.pdf', mimeType: 'application/pdf', sizeKb: 5 },
      attachments: [{ type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: 'pdfdata' } }],
    });
    const w = makeWiring([makeToolUseStream('tu_1', 'readpdf', { value: 'x' }), makeEndTurnStream('done')], [tool]);
    await w.queryRunner.run(makeInput({ messages: ['read the pdf'] }));
    const toolResult = getToolResult(w, 1);

    const actual = getDocumentBlock(toolResult)?.source.media_type;
    const expected = 'application/pdf';
    expect(actual).toBe(expected);
  });

  it('document block source data matches in tool result content', async () => {
    const tool = makeTool('readpdf', async () => 'ignored');
    (tool as any).handler = async () => ({
      textContent: { type: 'binary', path: '/doc.pdf', mimeType: 'application/pdf', sizeKb: 5 },
      attachments: [{ type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: 'pdfdata' } }],
    });
    const w = makeWiring([makeToolUseStream('tu_1', 'readpdf', { value: 'x' }), makeEndTurnStream('done')], [tool]);
    await w.queryRunner.run(makeInput({ messages: ['read the pdf'] }));
    const toolResult = getToolResult(w, 1);

    const actual = getDocumentBlock(toolResult)?.source.data;
    const expected = 'pdfdata';
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// turn_content
// ---------------------------------------------------------------------------

describe('QueryRunner — turn_content', () => {
  it('emits turn_content after message_usage', async () => {
    const w = makeWiring([makeEndTurnStream('hello')]);
    await w.queryRunner.run(makeInput());

    const msgs = w.channel.messages;
    const usageIdx = msgs.findIndex((m) => m.type === 'message_usage');
    const contentIdx = msgs.findIndex((m) => m.type === 'turn_content');
    const expected = true;
    const actual = usageIdx !== -1 && contentIdx !== -1 && usageIdx < contentIdx;
    expect(actual).toBe(expected);
  });

  it('emits turn_content before done', async () => {
    const w = makeWiring([makeEndTurnStream('hello')]);
    await w.queryRunner.run(makeInput());

    const msgs = w.channel.messages;
    const contentIdx = msgs.findIndex((m) => m.type === 'turn_content');
    const doneIdx = msgs.findIndex((m) => m.type === 'done');
    const expected = true;
    const actual = contentIdx !== -1 && doneIdx !== -1 && contentIdx < doneIdx;
    expect(actual).toBe(expected);
  });

  it('turn_content blocks contain the assembled text', async () => {
    const w = makeWiring([makeEndTurnStream('hello world')]);
    await w.queryRunner.run(makeInput());

    const msg = w.channel.messages.find((m) => m.type === 'turn_content');
    if (msg?.type !== 'turn_content') throw new Error('unreachable');
    const expected = 'hello world';
    const actual = (msg.blocks.find((b) => b.type === 'text') as { type: 'text'; text: string } | undefined)?.text;
    expect(actual).toBe(expected);
  });

  it('emits turn_content before the next query_summary in a tool-use loop', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const w = makeWiring(
      [makeToolUseStream('tu_1', 'echo', { value: 'hi' }), makeEndTurnStream('done')],
      [tool],
    );
    await w.queryRunner.run(makeInput({ messages: ['do it'] }));

    const msgs = w.channel.messages;
    const firstContentIdx = msgs.findIndex((m) => m.type === 'turn_content');
    const summaries = msgs.map((m, i) => ({ m, i })).filter(({ m }) => m.type === 'query_summary');
    const secondSummaryIdx = summaries[1]?.i ?? -1;
    const expected = true;
    const actual = firstContentIdx !== -1 && secondSummaryIdx !== -1 && firstContentIdx < secondSummaryIdx;
    expect(actual).toBe(expected);
  });
});
