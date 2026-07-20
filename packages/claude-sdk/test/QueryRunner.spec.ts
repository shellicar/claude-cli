import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta.mjs';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApprovalCoordinator } from '../src/private/ApprovalCoordinator.js';
import type { IPublisher } from '../src/private/ControlChannel.js';
import { Conversation } from '../src/private/Conversation.js';
import { AccountLimitStoppedError, ApiStreamError, HttpError } from '../src/private/http/errors.js';
import { QueryRunner } from '../src/private/QueryRunner.js';
import { ToolBlockNotifier } from '../src/private/ToolBlockNotifier.js';
import { ToolRegistry } from '../src/private/ToolRegistry.js';
import type { MessageStreamResult } from '../src/private/types.js';
import { IDurableConfigProvider } from '../src/public/IDurableConfigProvider.js';
import { ISdkMessagePublisher } from '../src/public/ISdkMessagePublisher.js';
import { IToolRegistry, ITurnRunner } from '../src/public/interfaces.js';
import { ToolCancelledError } from '../src/public/ToolCancelledError.js';
import type { AnyToolDefinition, ContentBlock, DocumentBlock, DurableConfig, PerQueryInput, SdkMessage, TextBlock, ToolResultBlock, TurnInput } from '../src/public/types.js';
import { IToolBlockNotifier, IToolsClockListener } from '../src/public/types.js';

// ---------------------------------------------------------------------------
// Fake TurnRunner. QueryRunner tests verify *conversation* behaviour, so the
// streaming engine beneath it is replaced by a fake that mirrors the real
// TurnRunner contract: push the assembled assistant message when the result
// carries blocks, then return the scripted result (or throw the scripted error).
// ---------------------------------------------------------------------------

function toParam(b: ContentBlock): BetaContentBlockParam {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text };
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
    case 'thinking':
      return { type: 'thinking', thinking: b.thinking, signature: b.signature };
    default:
      throw new Error(`toParam: unhandled block type ${b.type}`);
  }
}

class FakeTurnRunner extends ITurnRunner {
  public readonly calls: TurnInput[] = [];
  // The role of the conversation's last message at each call — proves a garbled
  // turn was rolled back before the resend.
  public readonly snapshots: (string | undefined)[] = [];
  readonly #responses: Array<MessageStreamResult | Error>;

  public constructor(responses: Array<MessageStreamResult | Error>) {
    super();
    this.#responses = [...responses];
  }

  public async run(conversation: Conversation, _durable: DurableConfig, turnInput: TurnInput): Promise<MessageStreamResult> {
    this.calls.push(turnInput);
    this.snapshots.push(conversation.messages.at(-1)?.role);
    const next = this.#responses.shift();
    if (next == null) {
      throw new Error('FakeTurnRunner: no more scripted results');
    }
    if (next instanceof Error) {
      throw next;
    }
    const content = next.blocks.map(toParam);
    if (content.length > 0) {
      conversation.push({ role: 'assistant', content });
    }
    return next;
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

class NoopToolsClock extends IToolsClockListener {
  public toolsStarted(): void {}
  public toolsStopped(): void {}
}

// Records the tools-clock edges so a test can prove the bracket opened and
// closed even on a path where no tool actually runs.
class SpyToolsClock extends IToolsClockListener {
  public startedCount = 0;
  public stoppedCount = 0;
  public toolsStarted(): void {
    this.startedCount++;
  }
  public toolsStopped(): void {
    this.stoppedCount++;
  }
}

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

// Minimal IDurableConfigProvider fake: QueryRunner reads only `.config`, so the
// other contract methods are inert stubs.
class FakeDurableConfigProvider extends IDurableConfigProvider {
  readonly #config: DurableConfig;

  public constructor(config: DurableConfig) {
    super();
    this.#config = config;
  }

  public get config(): DurableConfig {
    return this.#config;
  }

  public update(): void {}
  public updateIdentityBody(): void {}
  public async resolveSystemPromptsFor(): Promise<void> {}
  public async resolveSkillCatalogue(): Promise<void> {}
  public needsSystemPromptResolve(): boolean {
    return false;
  }
  public getEffectiveModel(): string {
    return this.#config.model;
  }
  public getEffectiveThinkingEnabled(): boolean {
    return false;
  }
  public getEffectiveEffort(): undefined {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Result fixtures
// ---------------------------------------------------------------------------

function zeroUsage() {
  return { inputTokens: 10, cacheCreationTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0, outputTokens: 5 };
}

function endTurnResult(text = 'done'): MessageStreamResult {
  return { blocks: [{ type: 'text', text }], stopReason: 'end_turn', contextManagementOccurred: false, usage: zeroUsage() };
}

function toolUseResult(id: string, name: string, input: Record<string, unknown> = {}): MessageStreamResult {
  return { blocks: [{ type: 'tool_use', id, name, input }], stopReason: 'tool_use', contextManagementOccurred: false, usage: zeroUsage() };
}

function multiToolUseResult(uses: Array<{ id: string; name: string; input?: Record<string, unknown> }>): MessageStreamResult {
  return { blocks: uses.map((u) => ({ type: 'tool_use' as const, id: u.id, name: u.name, input: u.input ?? {} })), stopReason: 'tool_use', contextManagementOccurred: false, usage: zeroUsage() };
}

// stop_reason tool_use but only a text block — the garbled-tool-use condition.
function garbledResult(text = 'let me check'): MessageStreamResult {
  return { blocks: [{ type: 'text', text }], stopReason: 'tool_use', contextManagementOccurred: false, usage: zeroUsage() };
}

// ---------------------------------------------------------------------------
// Tool + wiring helpers
// ---------------------------------------------------------------------------

function makeTool(name: string, handler: (input: { value: string }) => Promise<unknown>): AnyToolDefinition {
  const schema = z.object({ value: z.string() });
  return {
    name,
    description: `Tool ${name}`,
    input_schema: schema,
    output_schema: z.unknown(),
    input_examples: [{ value: 'example' }],
    handler: (async (input: { value: string }) => ({ textContent: await handler(input) })) as AnyToolDefinition['handler'],
  };
}

function makeBinaryTool(name: string): AnyToolDefinition {
  const schema = z.object({ value: z.string() });
  return {
    name,
    description: `Tool ${name}`,
    input_schema: schema,
    output_schema: z.unknown(),
    input_examples: [{ value: 'example' }],
    handler: (async () => ({
      textContent: { type: 'binary', path: '/doc.pdf', mimeType: 'application/pdf', sizeKb: 5 },
      attachments: [{ type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: 'pdfdata' } }],
    })) as AnyToolDefinition['handler'],
  };
}

function makeCancellableTool(name: string): { tool: AnyToolDefinition; started: Promise<void> } {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const schema = z.object({ value: z.string() });
  const tool: AnyToolDefinition = {
    name,
    description: `Tool ${name}`,
    input_schema: schema,
    output_schema: z.unknown(),
    input_examples: [{ value: 'example' }],
    handler: (async (_input: { value: string }, signal?: AbortSignal) => {
      markStarted();
      return await new Promise<{ textContent: unknown }>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new ToolCancelledError()));
      });
    }) as AnyToolDefinition['handler'],
  };
  return { tool, started };
}

// A tool that records the moment it starts and then waits on a shared, externally-resolved
// gate before returning. Two such tools in one batch prove concurrency: both `started` promises
// resolve before the gate is released, which is only possible if both handlers are in flight at
// once. Under sequential dispatch, the second tool never starts until the first (still blocked on
// the ungated `gate`) returns, so its `started` promise hangs and the test above it times out.
function makeGatedTool(name: string, gate: Promise<void>): { tool: AnyToolDefinition; started: Promise<void> } {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const schema = z.object({ value: z.string() });
  const tool: AnyToolDefinition = {
    name,
    description: `Tool ${name}`,
    input_schema: schema,
    output_schema: z.unknown(),
    input_examples: [{ value: 'example' }],
    handler: (async (input: { value: string }) => {
      markStarted();
      await gate;
      return { textContent: `got: ${input.value}` };
    }) as AnyToolDefinition['handler'],
  };
  return { tool, started };
}

function makeDurable(overrides: Partial<DurableConfig> = {}): DurableConfig {
  return { model: 'claude-opus-4-5' as DurableConfig['model'], maxTokens: 1024, tools: [], ...overrides };
}

function makeInput(overrides: Partial<PerQueryInput> = {}): PerQueryInput {
  return { messages: ['hi'], abortController: new AbortController(), ...overrides };
}

type Wiring = {
  turnRunner: FakeTurnRunner;
  registry: ToolRegistry;
  approval: ApprovalCoordinator;
  channel: FakeSdkPublisher;
  conversation: Conversation;
  queryRunner: QueryRunner;
};

function makeWiring(responses: Array<MessageStreamResult | Error>, tools: AnyToolDefinition[] = [], durableOverrides: Partial<DurableConfig> = {}, conversation?: Conversation, toolsClock: IToolsClockListener = new NoopToolsClock()): Wiring {
  const turnRunner = new FakeTurnRunner(responses);
  const approval = new ApprovalCoordinator();
  const channel = new FakeSdkPublisher();
  const conv = conversation ?? new Conversation();
  const durable = makeDurable({ tools, ...durableOverrides });
  const registry = new ToolRegistry(tools, new NoopLogger());
  const durableProvider = new FakeDurableConfigProvider(durable);

  const services = createServiceCollection();
  services.register(ITurnRunner).to(ITurnRunner, () => turnRunner);
  services.register(Conversation).to(Conversation, () => conv);
  services.register(IToolRegistry).to(IToolRegistry, () => registry);
  services.register(ApprovalCoordinator).to(ApprovalCoordinator, () => approval);
  services.register(ISdkMessagePublisher).to(ISdkMessagePublisher, () => channel);
  services.register(IDurableConfigProvider).to(IDurableConfigProvider, () => durableProvider);
  services.register(ILogger).to(ILogger, () => new NoopLogger());
  services.register(IToolsClockListener).to(IToolsClockListener, () => toolsClock);
  services.register(IToolBlockNotifier).to(IToolBlockNotifier, () => new ToolBlockNotifier([]));
  services.register(QueryRunner).to(QueryRunner);
  const queryRunner = services.buildProvider().resolve(QueryRunner);
  return { turnRunner, registry, approval, channel, conversation: conv, queryRunner };
}

function findToolResult(conv: Conversation): ToolResultBlock | undefined {
  let found: ToolResultBlock | undefined;
  for (const m of conv.messages) {
    if (m.role !== 'user' || !Array.isArray(m.content)) {
      continue;
    }
    const tr = m.content.find((b) => typeof b === 'object' && 'type' in b && b.type === 'tool_result');
    if (tr) {
      found = tr as ToolResultBlock;
    }
  }
  return found;
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
  it('runs exactly one turn for a terminal response', async () => {
    const w = makeWiring([endTurnResult('hello')]);
    await w.queryRunner.run(makeInput({ messages: ['hi'] }));
    const actual = w.turnRunner.calls.length;
    expect(actual).toBe(1);
  });

  it('records the user then the assistant message in the conversation', async () => {
    const w = makeWiring([endTurnResult('hello')]);
    await w.queryRunner.run(makeInput({ messages: ['hi'] }));
    const actual = w.conversation.messages.map((m) => m.role);
    expect(actual).toEqual(['user', 'assistant']);
  });

  it('sends done with the stop reason on a terminal turn', async () => {
    const w = makeWiring([endTurnResult('hello')]);
    await w.queryRunner.run(makeInput({ messages: ['hi'] }));
    const actual = w.channel.messages.find((m) => m.type === 'done');
    expect(actual).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('emits query_summary on the channel', async () => {
    const w = makeWiring([endTurnResult('hello')]);
    await w.queryRunner.run(makeInput());
    const actual = w.channel.messages.some((m) => m.type === 'query_summary');
    expect(actual).toBe(true);
  });

  // Per-turn usage is emitted by the StreamProcessor as the API's usage frames arrive, not by the
  // QueryRunner (see StreamProcessor.spec — usage frames). The wiring here fakes the TurnRunner, so no
  // stream runs and no message_usage reaches this channel.
});

// ---------------------------------------------------------------------------
// Tool-use loop
// ---------------------------------------------------------------------------

describe('QueryRunner — tool-use loop', () => {
  it('continues to a terminal turn after running a tool', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const w = makeWiring([toolUseResult('tu_1', 'echo', { value: 'hi' }), endTurnResult('done')], [tool]);
    await w.queryRunner.run(makeInput({ messages: ['do it'] }));
    const actual = w.turnRunner.calls.length;
    expect(actual).toBe(2);
  });

  it('invokes the handler with the parsed input', async () => {
    let handlerCalledWith: { value: string } | undefined;
    const tool = makeTool('echo', async (input) => {
      handlerCalledWith = input;
      return `got: ${input.value}`;
    });
    const w = makeWiring([toolUseResult('tu_1', 'echo', { value: 'hi' }), endTurnResult('done')], [tool]);
    await w.queryRunner.run(makeInput({ messages: ['do it'] }));
    expect(handlerCalledWith).toEqual({ value: 'hi' });
  });

  it('delivers a tool_result with the matching tool_use id', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const w = makeWiring([toolUseResult('tu_1', 'echo', { value: 'hi' }), endTurnResult('done')], [tool]);
    await w.queryRunner.run(makeInput({ messages: ['do it'] }));
    const actual = findToolResult(w.conversation)?.tool_use_id;
    expect(actual).toBe('tu_1');
  });

  it('carries the handler output in the tool_result', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const w = makeWiring([toolUseResult('tu_1', 'echo', { value: 'hi' }), endTurnResult('done')], [tool]);
    await w.queryRunner.run(makeInput({ messages: ['do it'] }));
    const actual = getTextBlock(findToolResult(w.conversation))?.text;
    expect(actual).toContain('got: hi');
  });

  it('stays silent on the channel for a not_found tool', async () => {
    const w = makeWiring([toolUseResult('tu_1', 'missing', { value: 'hi' }), endTurnResult('done')], []);
    await w.queryRunner.run(makeInput());
    const actual = w.channel.messages.filter((m) => m.type === 'tool_error').length;
    expect(actual).toBe(0);
  });

  it('returns an is_error tool_result for a not_found tool', async () => {
    const w = makeWiring([toolUseResult('tu_1', 'missing', { value: 'hi' }), endTurnResult('done')], []);
    await w.queryRunner.run(makeInput());
    const actual = findToolResult(w.conversation)?.is_error;
    expect(actual).toBe(true);
  });

  it('sends tool_error on the channel for invalid input', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const w = makeWiring([toolUseResult('tu_1', 'echo', { wrong: 'field' }), endTurnResult('done')], [tool]);
    await w.queryRunner.run(makeInput());
    const actual = w.channel.messages.filter((m) => m.type === 'tool_error').length;
    expect(actual).toBe(1);
  });

  it('sends tool_error with the thrown message on a handler error', async () => {
    const tool = makeTool('boom', async () => {
      throw new Error('kaboom');
    });
    const w = makeWiring([toolUseResult('tu_1', 'boom', { value: 'hi' }), endTurnResult('done')], [tool]);
    await w.queryRunner.run(makeInput());
    const actual = w.channel.messages.find((m) => m.type === 'tool_error');
    expect(actual).toMatchObject({ type: 'tool_error', name: 'boom', error: 'kaboom' });
  });
});

// ---------------------------------------------------------------------------
// ephemeral reminder lifecycle (first-turn-only)
// ---------------------------------------------------------------------------

describe('QueryRunner — ephemeral reminders', () => {
  const ephemeral = { text: 'stay focused', persisted: false as const, position: 'trailing' as const };

  it('passes the ephemeral reminders to the first turn', async () => {
    const w = makeWiring([toolUseResult('tu_1', 'echo', { value: 'hi' }), endTurnResult('done')], [makeTool('echo', async (i) => i.value)]);
    await w.queryRunner.run(makeInput({ reminders: [ephemeral] }));
    const actual = w.turnRunner.calls[0]?.ephemeralReminders;
    expect(actual).toEqual([ephemeral]);
  });

  it('passes undefined to the second turn', async () => {
    const w = makeWiring([toolUseResult('tu_1', 'echo', { value: 'hi' }), endTurnResult('done')], [makeTool('echo', async (i) => i.value)]);
    await w.queryRunner.run(makeInput({ reminders: [ephemeral] }));
    const actual = w.turnRunner.calls[1]?.ephemeralReminders;
    expect(actual).toBeUndefined();
  });

  it('first query_summary carries the ephemeral reminder text', async () => {
    const w = makeWiring([toolUseResult('tu_1', 'echo', { value: 'hi' }), endTurnResult('done')], [makeTool('echo', async (i) => i.value)]);
    await w.queryRunner.run(makeInput({ reminders: [ephemeral] }));
    const summaries = w.channel.messages.filter((m): m is Extract<SdkMessage, { type: 'query_summary' }> => m.type === 'query_summary');
    const actual = summaries[0]?.systemReminder;
    expect(actual).toBe('stay focused');
  });

  it('second query_summary omits the ephemeral reminder text', async () => {
    const w = makeWiring([toolUseResult('tu_1', 'echo', { value: 'hi' }), endTurnResult('done')], [makeTool('echo', async (i) => i.value)]);
    await w.queryRunner.run(makeInput({ reminders: [ephemeral] }));
    const summaries = w.channel.messages.filter((m): m is Extract<SdkMessage, { type: 'query_summary' }> => m.type === 'query_summary');
    const actual = summaries[1]?.systemReminder;
    expect(actual).toBeUndefined();
  });

  it('prepends a persisted-leading reminder to the opening user message and freezes it in history', async () => {
    const w = makeWiring([endTurnResult('done')], []);
    await w.queryRunner.run(makeInput({ messages: ['hello'], reminders: [{ text: 'skills changed', persisted: true, position: 'leading' }] }));
    const firstMsg = w.conversation.messages[0];
    const content = Array.isArray(firstMsg?.content) ? firstMsg.content : [];
    const actual = content[0];
    expect(actual).toMatchObject({ type: 'text', text: expect.stringContaining('skills changed') });
  });
});

// ---------------------------------------------------------------------------
// cachedReminders injection
// ---------------------------------------------------------------------------

describe('QueryRunner — cachedReminders', () => {
  it('injects cached reminders into the first user message on a fresh conversation', async () => {
    const w = makeWiring([endTurnResult('done')], [], { cachedReminders: ['be careful'] });
    await w.queryRunner.run(makeInput({ messages: ['hello'] }));
    const firstMsg = w.conversation.messages[0];
    const content = Array.isArray(firstMsg?.content) ? firstMsg.content : [];
    const actual = content[0];
    expect(actual).toMatchObject({ type: 'text', text: expect.stringContaining('<system-reminder>') });
  });

  it('does not inject cached reminders when the conversation already has user messages', async () => {
    const existing = new Conversation();
    existing.push({ role: 'user', content: 'earlier' });
    existing.push({ role: 'assistant', content: [{ type: 'text', text: 'earlier response' }] });
    const w = makeWiring([endTurnResult('done')], [], { cachedReminders: ['be careful'] }, existing);
    await w.queryRunner.run(makeInput({ messages: ['hello again'] }));
    const actual = w.conversation.messages.some((m) => {
      const blocks = Array.isArray(m.content) ? m.content : [];
      return blocks.some((b) => typeof b === 'object' && 'text' in b && typeof b.text === 'string' && b.text.includes('be careful'));
    });
    expect(actual).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Approval flow
// ---------------------------------------------------------------------------

describe('QueryRunner — approval', () => {
  it('runs the tool when approval is required and granted', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const w = makeWiring([toolUseResult('tu_1', 'echo', { value: 'hi' }), endTurnResult('done')], [tool], { requireToolApproval: true });

    const runPromise = w.queryRunner.run(makeInput());
    await new Promise((resolve) => setImmediate(resolve));
    const approvalRequest = w.channel.messages.find((m) => m.type === 'tool_approval_request');
    if (approvalRequest?.type !== 'tool_approval_request') {
      throw new Error('unreachable');
    }
    w.approval.handle({ type: 'tool_approval_response', requestId: approvalRequest.requestId, approved: true });
    await runPromise;

    const actual = w.turnRunner.calls.length;
    expect(actual).toBe(2);
  });

  it('does not invoke the handler when approval is rejected', async () => {
    let handlerRan = false;
    const tool = makeTool('echo', async (input) => {
      handlerRan = true;
      return `got: ${input.value}`;
    });
    const w = makeWiring([toolUseResult('tu_1', 'echo', { value: 'hi' }), endTurnResult('done')], [tool], { requireToolApproval: true });

    const runPromise = w.queryRunner.run(makeInput());
    await new Promise((resolve) => setImmediate(resolve));
    const approvalRequest = w.channel.messages.find((m) => m.type === 'tool_approval_request');
    if (approvalRequest?.type !== 'tool_approval_request') {
      throw new Error('unreachable');
    }
    w.approval.handle({ type: 'tool_approval_response', requestId: approvalRequest.requestId, approved: false, reason: 'not today' });
    await runPromise;

    expect(handlerRan).toBe(false);
  });

  it('carries the rejection reason in the tool_result', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const w = makeWiring([toolUseResult('tu_1', 'echo', { value: 'hi' }), endTurnResult('done')], [tool], { requireToolApproval: true });

    const runPromise = w.queryRunner.run(makeInput());
    await new Promise((resolve) => setImmediate(resolve));
    const approvalRequest = w.channel.messages.find((m) => m.type === 'tool_approval_request');
    if (approvalRequest?.type !== 'tool_approval_request') {
      throw new Error('unreachable');
    }
    w.approval.handle({ type: 'tool_approval_response', requestId: approvalRequest.requestId, approved: false, reason: 'not today' });
    await runPromise;

    const actual = getTextBlock(findToolResult(w.conversation))?.text;
    expect(actual).toBe('not today');
  });
});

// ---------------------------------------------------------------------------
// Long-lived instance and reset
// ---------------------------------------------------------------------------

describe('QueryRunner — long-lived instance', () => {
  it('runs two queries in sequence on the same instance', async () => {
    const w = makeWiring([endTurnResult('first'), endTurnResult('second')]);
    await w.queryRunner.run(makeInput({ messages: ['first'] }));
    await w.queryRunner.run(makeInput({ messages: ['second'] }));
    const actual = w.turnRunner.calls.length;
    expect(actual).toBe(2);
  });

  it('does not close the channel between queries', async () => {
    const w = makeWiring([endTurnResult('first'), endTurnResult('second')]);
    await w.queryRunner.run(makeInput({ messages: ['first'] }));
    await w.queryRunner.run(makeInput({ messages: ['second'] }));
    const actual = w.channel.closeCount;
    expect(actual).toBe(0);
  });

  it('accumulates conversation history across queries', async () => {
    const w = makeWiring([endTurnResult('first'), endTurnResult('second')]);
    await w.queryRunner.run(makeInput({ messages: ['first'] }));
    await w.queryRunner.run(makeInput({ messages: ['second'] }));
    const actual = w.conversation.messages.map((m) => m.role);
    expect(actual).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('resets cancelled so a subsequent run proceeds', async () => {
    const w = makeWiring([endTurnResult('second try')]);
    w.approval.handle({ type: 'cancel' });
    await w.queryRunner.run(makeInput({ messages: ['go'] }));
    const actual = w.turnRunner.calls.length;
    expect(actual).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// tool_result content array for binary outputs
// ---------------------------------------------------------------------------

describe('QueryRunner — tool_result content array for binary outputs', () => {
  it('tool result tool_use_id matches the triggered tool use', async () => {
    const w = makeWiring([toolUseResult('tu_1', 'readpdf', { value: 'x' }), endTurnResult('done')], [makeBinaryTool('readpdf')]);
    await w.queryRunner.run(makeInput({ messages: ['read the pdf'] }));
    const actual = findToolResult(w.conversation)?.tool_use_id;
    expect(actual).toBe('tu_1');
  });

  it('tool result content is an array for binary tool output', async () => {
    const w = makeWiring([toolUseResult('tu_1', 'readpdf', { value: 'x' }), endTurnResult('done')], [makeBinaryTool('readpdf')]);
    await w.queryRunner.run(makeInput({ messages: ['read the pdf'] }));
    const actual = Array.isArray(findToolResult(w.conversation)?.content);
    expect(actual).toBe(true);
  });

  it('tool result text block contains the file path', async () => {
    const w = makeWiring([toolUseResult('tu_1', 'readpdf', { value: 'x' }), endTurnResult('done')], [makeBinaryTool('readpdf')]);
    await w.queryRunner.run(makeInput({ messages: ['read the pdf'] }));
    const actual = getTextBlock(findToolResult(w.conversation))?.text;
    expect(actual).toContain('/doc.pdf');
  });

  it('document block is present in the tool result content array', async () => {
    const w = makeWiring([toolUseResult('tu_1', 'readpdf', { value: 'x' }), endTurnResult('done')], [makeBinaryTool('readpdf')]);
    await w.queryRunner.run(makeInput({ messages: ['read the pdf'] }));
    const actual = getDocumentBlock(findToolResult(w.conversation)) !== undefined;
    expect(actual).toBe(true);
  });

  it('document block source media_type is application/pdf', async () => {
    const w = makeWiring([toolUseResult('tu_1', 'readpdf', { value: 'x' }), endTurnResult('done')], [makeBinaryTool('readpdf')]);
    await w.queryRunner.run(makeInput({ messages: ['read the pdf'] }));
    const actual = getDocumentBlock(findToolResult(w.conversation))?.source.media_type;
    expect(actual).toBe('application/pdf');
  });

  it('document block source data matches the handler output', async () => {
    const w = makeWiring([toolUseResult('tu_1', 'readpdf', { value: 'x' }), endTurnResult('done')], [makeBinaryTool('readpdf')]);
    await w.queryRunner.run(makeInput({ messages: ['read the pdf'] }));
    const actual = getDocumentBlock(findToolResult(w.conversation))?.source.data;
    expect(actual).toBe('pdfdata');
  });
});

// ---------------------------------------------------------------------------
// turn_content
// ---------------------------------------------------------------------------

describe('QueryRunner — turn_content', () => {
  it('emits turn_content before done', async () => {
    const w = makeWiring([endTurnResult('hello')]);
    await w.queryRunner.run(makeInput());
    const msgs = w.channel.messages;
    const contentIdx = msgs.findIndex((m) => m.type === 'turn_content');
    const doneIdx = msgs.findIndex((m) => m.type === 'done');
    const actual = contentIdx !== -1 && doneIdx !== -1 && contentIdx < doneIdx;
    expect(actual).toBe(true);
  });

  it('turn_content blocks contain the assembled text', async () => {
    const w = makeWiring([endTurnResult('hello world')]);
    await w.queryRunner.run(makeInput());
    const msg = w.channel.messages.find((m) => m.type === 'turn_content');
    if (msg?.type !== 'turn_content') {
      throw new Error('unreachable');
    }
    const actual = (msg.blocks.find((b) => b.type === 'text') as { type: 'text'; text: string } | undefined)?.text;
    expect(actual).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// Garbled tool_use rollback (needs the result-shape + conversation-state
// condition, which the fake reproduces faithfully)
// ---------------------------------------------------------------------------

describe('QueryRunner — garbled tool_use rollback', () => {
  it('resends after a garbled tool_use turn', async () => {
    const w = makeWiring([garbledResult('let me check'), endTurnResult('done')]);
    await w.queryRunner.run(makeInput({ messages: ['do it'] }));
    const actual = w.turnRunner.calls.length;
    expect(actual).toBe(2);
  });

  it('rolls the garbled assistant turn back before the resend', async () => {
    const w = makeWiring([garbledResult('let me check'), endTurnResult('done')]);
    await w.queryRunner.run(makeInput({ messages: ['do it'] }));
    const actual = w.turnRunner.snapshots[1];
    expect(actual).toBe('user');
  });

  it('leaves only the clean turn in the conversation', async () => {
    const w = makeWiring([garbledResult('let me check'), endTurnResult('done')]);
    await w.queryRunner.run(makeInput({ messages: ['do it'] }));
    const actual = w.conversation.messages.map((m) => m.role);
    expect(actual).toEqual(['user', 'assistant']);
  });
});

// ---------------------------------------------------------------------------
// Tool cancellation
// ---------------------------------------------------------------------------

describe('QueryRunner — tool cancellation', () => {
  it('runs the delivery turn after a tool-cancel', async () => {
    const { tool, started } = makeCancellableTool('sleeper');
    const w = makeWiring([toolUseResult('tu_1', 'sleeper', { value: 'x' }), endTurnResult('stopped')], [tool]);
    const runPromise = w.queryRunner.run(makeInput({ messages: ['run it'] }));
    await started;
    w.approval.handle({ type: 'cancel' });
    await runPromise;
    const actual = w.turnRunner.calls.length;
    expect(actual).toBe(2);
  });

  it('delivers a cancellation tool_result to the model', async () => {
    const { tool, started } = makeCancellableTool('sleeper');
    const w = makeWiring([toolUseResult('tu_1', 'sleeper', { value: 'x' }), endTurnResult('stopped')], [tool]);
    const runPromise = w.queryRunner.run(makeInput());
    await started;
    w.approval.handle({ type: 'cancel' });
    await runPromise;
    const actual = getTextBlock(findToolResult(w.conversation))?.text;
    expect(actual).toContain('cancelled');
  });

  it('does not cancel the query on a tool-cancel', async () => {
    const { tool, started } = makeCancellableTool('sleeper');
    const w = makeWiring([toolUseResult('tu_1', 'sleeper', { value: 'x' }), endTurnResult('stopped')], [tool]);
    const runPromise = w.queryRunner.run(makeInput());
    await started;
    w.approval.handle({ type: 'cancel' });
    await runPromise;
    const actual = w.approval.cancelled;
    expect(actual).toBe(false);
  });

  it('aborts the query without a delivery turn on a second cancel', async () => {
    const { tool, started } = makeCancellableTool('sleeper');
    const w = makeWiring([toolUseResult('tu_1', 'sleeper', { value: 'x' }), endTurnResult('stopped')], [tool]);
    const runPromise = w.queryRunner.run(makeInput());
    await started;
    w.approval.handle({ type: 'cancel' });
    w.approval.handle({ type: 'cancel' });
    await runPromise;
    const actual = w.turnRunner.calls.length;
    expect(actual).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Concurrent tool execution. Proves #runTools fires every ready tool in a
// batch at once instead of awaiting them one at a time.
// ---------------------------------------------------------------------------

describe('QueryRunner — concurrent tool execution', () => {
  it('starts both tools before either is released', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const a = makeGatedTool('a', gate);
    const b = makeGatedTool('b', gate);
    const w = makeWiring([multiToolUseResult([{ id: 'tu_1', name: 'a', input: { value: 'x' } }, { id: 'tu_2', name: 'b', input: { value: 'y' } }]), endTurnResult('done')], [a.tool, b.tool]);

    const runPromise = w.queryRunner.run(makeInput());
    // Deterministic, not a timing race: under sequential dispatch this can never resolve
    // without `release()`, because `b` cannot start until `a` returns, and `a` cannot return
    // until the gate opens — which this test has not done yet. A regression here times out
    // the test rather than passing it.
    await Promise.all([a.started, b.started]);
    release();
    await runPromise;

    const actual = getTextBlock(findToolResult(w.conversation))?.text;
    expect(actual).toBeDefined();
  });

  it('runs both tools to completion once released', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const a = makeGatedTool('a', gate);
    const b = makeGatedTool('b', gate);
    const w = makeWiring([multiToolUseResult([{ id: 'tu_1', name: 'a', input: { value: 'x' } }, { id: 'tu_2', name: 'b', input: { value: 'y' } }]), endTurnResult('done')], [a.tool, b.tool]);

    const runPromise = w.queryRunner.run(makeInput());
    await Promise.all([a.started, b.started]);
    release();
    await runPromise;

    const actual = w.conversation.messages.some((m) => {
      const blocks = Array.isArray(m.content) ? m.content : [];
      return blocks.some((block) => typeof block === 'object' && 'type' in block && block.type === 'tool_result' && JSON.stringify(block).includes('got: y'));
    });
    expect(actual).toBe(true);
  });

  it('starts both approved tools before either, gated one, is released', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const a = makeGatedTool('a', gate);
    const b = makeGatedTool('b', gate);
    const w = makeWiring(
      [multiToolUseResult([{ id: 'tu_1', name: 'a', input: { value: 'x' } }, { id: 'tu_2', name: 'b', input: { value: 'y' } }]), endTurnResult('done')],
      [a.tool, b.tool],
      { requireToolApproval: true },
    );

    const runPromise = w.queryRunner.run(makeInput());
    await new Promise((resolve) => setImmediate(resolve));
    const requests = w.channel.messages.filter((m): m is Extract<SdkMessage, { type: 'tool_approval_request' }> => m.type === 'tool_approval_request');
    const requestA = requests.find((r) => r.name === 'a');
    const requestB = requests.find((r) => r.name === 'b');
    if (requestA == null || requestB == null) {
      throw new Error('unreachable');
    }
    w.approval.handle({ type: 'tool_approval_response', requestId: requestA.requestId, approved: true });
    w.approval.handle({ type: 'tool_approval_response', requestId: requestB.requestId, approved: true });
    // Deterministic: if an approved run were awaited before the next approval's run could
    // start, `b` would never start (its approval, once granted, still needs `a` to finish
    // first) — and `a` cannot finish without the release this test hasn't issued yet.
    await Promise.all([a.started, b.started]);
    release();
    await runPromise;

    const actual = w.turnRunner.calls.length;
    expect(actual).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Account-limit give-up termination (§9)
// ---------------------------------------------------------------------------

describe('QueryRunner — account-limit give-up', () => {
  it('ends the query cleanly with no error when TurnRunner throws AccountLimitStoppedError', async () => {
    const w = makeWiring([new AccountLimitStoppedError()]);
    await w.queryRunner.run(makeInput());
    const actual = w.channel.messages.filter((m) => m.type === 'error').length;
    expect(actual).toBe(0);
  });

  it('publishes an error when TurnRunner throws any other Error', async () => {
    const w = makeWiring([new Error('boom')]);
    await w.queryRunner.run(makeInput());
    const actual = w.channel.messages.filter((m) => m.type === 'error').length;
    expect(actual).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Structured error detail surfacing (the drop point this mission fixes)
// ---------------------------------------------------------------------------

function findError(w: Wiring): Extract<SdkMessage, { type: 'error' }> | undefined {
  return w.channel.messages.find((m): m is Extract<SdkMessage, { type: 'error' }> => m.type === 'error');
}

function anthropicErrorBody(type: string, message: string) {
  return { type: 'error', error: { type, message } };
}

describe('QueryRunner — error detail surfacing', () => {
  it('carries the HTTP status in the error event detail', async () => {
    const w = makeWiring([new HttpError(404, undefined, anthropicErrorBody('not_found_error', 'model: hello-world not found'), new Headers())]);
    await w.queryRunner.run(makeInput());
    const actual = findError(w)?.detail?.status;
    expect(actual).toBe(404);
  });

  it('carries the API error type in the error event detail', async () => {
    const w = makeWiring([new HttpError(404, undefined, anthropicErrorBody('not_found_error', 'model: hello-world not found'), new Headers())]);
    await w.queryRunner.run(makeInput());
    const actual = findError(w)?.detail?.type;
    expect(actual).toBe('not_found_error');
  });

  it('carries the body message in the error event detail', async () => {
    const w = makeWiring([new HttpError(404, undefined, anthropicErrorBody('not_found_error', 'model: hello-world not found'), new Headers())]);
    await w.queryRunner.run(makeInput());
    const actual = findError(w)?.detail?.message;
    expect(actual).toBe('model: hello-world not found');
  });

  it('falls back to the status string when the body carries no message', async () => {
    const w = makeWiring([new HttpError(500, undefined, undefined, new Headers())]);
    await w.queryRunner.run(makeInput());
    const actual = findError(w)?.detail?.message;
    expect(actual).toBe('HTTP 500');
  });

  it('carries the detail for a mid-stream ApiStreamError', async () => {
    const w = makeWiring([new ApiStreamError('overloaded_error', anthropicErrorBody('overloaded_error', 'Overloaded'))]);
    await w.queryRunner.run(makeInput());
    const actual = findError(w)?.detail?.message;
    expect(actual).toBe('Overloaded');
  });

  it('leaves detail undefined for a non-transport error', async () => {
    const w = makeWiring([new Error('boom')]);
    await w.queryRunner.run(makeInput());
    const actual = findError(w)?.detail;
    expect(actual).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Client tool_result publishing (history view capture)
// ---------------------------------------------------------------------------

describe('QueryRunner — publishes client tool_result', () => {
  it('sends a tool_result message for an executed client tool', async () => {
    const w = makeWiring([toolUseResult('t1', 'echo', { value: 'hi' }), endTurnResult('done')], [makeTool('echo', async (input) => input.value)]);
    await w.queryRunner.run(makeInput({ messages: ['go'] }));
    const published = w.channel.messages.find((m) => m.type === 'tool_result');
    expect(published).toBeDefined();
  });

  it('addresses the tool_result by the tool_use id', async () => {
    const w = makeWiring([toolUseResult('t1', 'echo', { value: 'hi' }), endTurnResult('done')], [makeTool('echo', async (input) => input.value)]);
    await w.queryRunner.run(makeInput({ messages: ['go'] }));
    const published = w.channel.messages.find((m) => m.type === 'tool_result');
    const expected = 't1';
    const actual = published?.type === 'tool_result' ? published.id : undefined;
    expect(actual).toBe(expected);
  });

  it('marks a not-found tool result as an error', async () => {
    const w = makeWiring([toolUseResult('t1', 'missing', { value: 'hi' }), endTurnResult('done')], []);
    await w.queryRunner.run(makeInput({ messages: ['go'] }));
    const published = w.channel.messages.find((m) => m.type === 'tool_result');
    const expected = true;
    const actual = published?.type === 'tool_result' ? published.isError : undefined;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Tools-clock bracket. The clock brackets the whole tool-handling method, so
// it opens and closes even when the batch reaches no tool run — the approval
// wait the old first-run bracket left unattributed.
// ---------------------------------------------------------------------------

describe('QueryRunner — tools-clock bracket', () => {
  it('opens the tools clock when the batch runs no tool', async () => {
    const clock = new SpyToolsClock();
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const w = makeWiring([toolUseResult('tu_1', 'echo', { value: 'hi' }), endTurnResult('done')], [tool], { requireToolApproval: true }, undefined, clock);

    const runPromise = w.queryRunner.run(makeInput());
    await new Promise((resolve) => setImmediate(resolve));
    const approvalRequest = w.channel.messages.find((m) => m.type === 'tool_approval_request');
    if (approvalRequest?.type !== 'tool_approval_request') {
      throw new Error('unreachable');
    }
    w.approval.handle({ type: 'tool_approval_response', requestId: approvalRequest.requestId, approved: false, reason: 'no' });
    await runPromise;

    const actual = clock.startedCount;
    expect(actual).toBe(1);
  });

  it('closes the tools clock when the batch runs no tool', async () => {
    const clock = new SpyToolsClock();
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const w = makeWiring([toolUseResult('tu_1', 'echo', { value: 'hi' }), endTurnResult('done')], [tool], { requireToolApproval: true }, undefined, clock);

    const runPromise = w.queryRunner.run(makeInput());
    await new Promise((resolve) => setImmediate(resolve));
    const approvalRequest = w.channel.messages.find((m) => m.type === 'tool_approval_request');
    if (approvalRequest?.type !== 'tool_approval_request') {
      throw new Error('unreachable');
    }
    w.approval.handle({ type: 'tool_approval_response', requestId: approvalRequest.requestId, approved: false, reason: 'no' });
    await runPromise;

    const actual = clock.stoppedCount;
    expect(actual).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tool-execution event bracket (tool_exec_start / tool_exec_end). These drive
// the CLI's separate execution block, so they must be emitted around the actual
// run — start before the tool_result, end after it.
// ---------------------------------------------------------------------------

describe('QueryRunner — tool-execution event bracket', () => {
  it('publishes tool_exec_start then tool_exec_end on a tool-use turn', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const w = makeWiring([toolUseResult('tu_1', 'echo', { value: 'hi' }), endTurnResult('done')], [tool]);
    await w.queryRunner.run(makeInput({ messages: ['go'] }));
    const expected = ['tool_exec_start', 'tool_exec_end'];
    const actual = w.channel.messages.filter((m) => m.type === 'tool_exec_start' || m.type === 'tool_exec_end').map((m) => m.type);
    expect(actual).toEqual(expected);
  });

  it('brackets the tool_result: exec_start before it, exec_end after it', async () => {
    const tool = makeTool('echo', async (input) => `got: ${input.value}`);
    const w = makeWiring([toolUseResult('tu_1', 'echo', { value: 'hi' }), endTurnResult('done')], [tool]);
    await w.queryRunner.run(makeInput({ messages: ['go'] }));
    const types = w.channel.messages.map((m) => m.type);
    const startIdx = types.indexOf('tool_exec_start');
    const resultIdx = types.indexOf('tool_result');
    const endIdx = types.indexOf('tool_exec_end');
    const expected = true;
    const actual = startIdx < resultIdx && resultIdx < endIdx;
    expect(actual).toBe(expected);
  });

  it('emits no tool-execution events on a terminal turn with no tools', async () => {
    const w = makeWiring([endTurnResult('hello')]);
    await w.queryRunner.run(makeInput({ messages: ['hi'] }));
    const expected = 0;
    const actual = w.channel.messages.filter((m) => m.type === 'tool_exec_start' || m.type === 'tool_exec_end').length;
    expect(actual).toBe(expected);
  });
});
