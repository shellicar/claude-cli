import { Clock, Instant, ZoneId } from '@js-joda/core';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { IHistoryWriter } from '@shellicar/claude-core/history/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IRandomProvider } from '@shellicar/claude-core/providers/IRandomProvider';
import { ISleepProvider } from '@shellicar/claude-core/providers/ISleepProvider';
import {
  type AnyToolDefinition,
  type DurableConfig,
  IDisabledToolsProvider,
  IDurableConfigProvider,
  IMessageStreamer,
  IToolBlockNotifier,
  IWakeLock,
  type ThinkingEffort,
  type WakeLockHandle,
} from '@shellicar/claude-sdk';
import { createServiceCollection } from '@shellicar/core-di';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ApprovalCorrelation, IApprovalHolder, Settlement } from '../src/approval/ApprovalHolder.js';
import { AuditWriter } from '../src/AuditWriter.js';
import { IBus, type ServeHandler } from '../src/bus/IBus.js';
import { IConversationState } from '../src/model/ConversationState.js';
import { StatusState } from '../src/model/StatusState.js';
import { ToolApprovalState } from '../src/model/ToolApprovalState.js';
import { createSubagentTool } from '../src/subagent/createSubagentTool.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

class NoopHistoryWriter implements IHistoryWriter {
  public insert(): void {}
}

/** Only addBlocks is exercised — everything else on IConversationState is unused by Subagent. */
class StubConversationState extends IConversationState {
  public readonly received: unknown[] = [];
  public addBlocks(blocks: readonly unknown[]): void {
    this.received.push(...blocks);
  }
  public on(): void {}
  public off(): void {}
  public advanceFlushedCount(): void {}
  public clear(): void {}
  public get sealedBlocks(): [] {
    return [];
  }
  public get flushedCount(): number {
    return 0;
  }
  public get activeBlock(): null {
    return null;
  }
  public get promptStartedAt(): null {
    return null;
  }
  public markPromptStart(): void {}
  public transitionBlock(): { noop: boolean; from: null; sealed: boolean } {
    return { noop: true, from: null, sealed: false };
  }
  public appendToActive(): void {}
  public appendStreaming(): void {}
  public replaceActiveFromOffset(): void {}
  public setActiveBlockContent(): void {}
  public spliceNotice(): void {}
  public setLastContent(): void {}
  public setLastTools(): void {}
  public completeActive(): void {}
  public appendToLastSealed(): 'miss' {
    return 'miss';
  }
}

/** Records every publish so a test can assert the subagent actually emitted deltas/telemetry. */
class RecordingBus extends IBus {
  public readonly published: { subject: string; body: unknown }[] = [];
  public async start(): Promise<void> {}
  public publish(subject: string, payload: Uint8Array): void {
    this.published.push({ subject, body: JSON.parse(new TextDecoder().decode(payload)) });
  }
  public subscribe(): () => void {
    return () => {};
  }
  public async request(): Promise<{ timeout: true }> {
    return { timeout: true };
  }
  public serve(_subject: string, _handler: ServeHandler): () => void {
    return () => {};
  }
  public async stop(): Promise<void> {}
}

class FakeDurableConfigProvider extends IDurableConfigProvider {
  public get config(): DurableConfig {
    return { model: 'claude-test', maxTokens: 1024, tools: [], requireToolApproval: true, thinking: false };
  }
  public update(): void {}
  public updateIdentityBody(): void {}
  public async resolveSystemPromptsFor(): Promise<void> {}
  public async resolveSkillCatalogue(): Promise<void> {}
  public needsSystemPromptResolve(): boolean {
    return false;
  }
  public getEffectiveModel(): string {
    return 'claude-test';
  }
  public getEffectiveThinkingEnabled(): boolean {
    return false;
  }
  public getEffectiveEffort(): ThinkingEffort | undefined {
    return undefined;
  }
}

class EmptyDisabledTools extends IDisabledToolsProvider {
  public get disabledTools(): ReadonlySet<string> {
    return new Set();
  }
}

class NoopWakeLock extends IWakeLock {
  public acquire(): WakeLockHandle {
    return { release: () => {} };
  }
}

class NoopToolBlockNotifier extends IToolBlockNotifier {
  public async blockEnded(): Promise<void> {}
}

/** Auto-approves — the plain-text smoke test has no tools, so it is never actually exercised. */
class AutoApproveHolder implements IApprovalHolder {
  public async raise(_req: unknown, _correlation: ApprovalCorrelation): Promise<Settlement> {
    return { approved: true, by: { kind: 'human' } };
  }
  public settle(): void {}
}

/** Never answers on its own — used to prove the LOCAL ToolApprovalState path wins the race
 *  when nothing is listening on the wire, which is the whole point of that design. */
class NeverAnswersHolder implements IApprovalHolder {
  public raise(): Promise<Settlement> {
    return new Promise(() => {});
  }
  public settle(): void {}
}

const MESSAGE_START: BetaRawMessageStreamEvent = {
  type: 'message_start',
  message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'claude-test', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
} as unknown as BetaRawMessageStreamEvent;

function textStreamEvents(text: string): BetaRawMessageStreamEvent[] {
  return [
    MESSAGE_START,
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: null } } as BetaRawMessageStreamEvent,
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } as BetaRawMessageStreamEvent,
    { type: 'content_block_stop', index: 0 } as BetaRawMessageStreamEvent,
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } } as BetaRawMessageStreamEvent,
    { type: 'message_stop' } as BetaRawMessageStreamEvent,
  ];
}

function toolUseStreamEvents(id: string, name: string, inputJson: string): BetaRawMessageStreamEvent[] {
  return [
    MESSAGE_START,
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } } as BetaRawMessageStreamEvent,
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: inputJson } } as BetaRawMessageStreamEvent,
    { type: 'content_block_stop', index: 0 } as BetaRawMessageStreamEvent,
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 4 } } as BetaRawMessageStreamEvent,
    { type: 'message_stop' } as BetaRawMessageStreamEvent,
  ];
}

type SdkMessageStream = AsyncIterable<BetaRawMessageStreamEvent>;

class FakeMessageStreamer extends IMessageStreamer {
  #scripts: BetaRawMessageStreamEvent[][];
  public constructor(scripts: BetaRawMessageStreamEvent[][]) {
    super();
    this.#scripts = [...scripts];
  }
  public stream(_body: BetaMessageStreamParams, _options: Anthropic.RequestOptions): SdkMessageStream {
    const events = this.#scripts.shift();
    if (events == null) {
      throw new Error('FakeMessageStreamer: no more scripted turns');
    }
    return (async function* () {
      for (const event of events) {
        yield event;
      }
    })();
  }
}

/** The real root provider Subagent opens a scope on \u2014 built once per test, matching the shape
 *  createSubagentTool expects to find already registered as shared singletons. */
type PermissionActionName = 'approve' | 'ask' | 'deny';

function buildRootProvider(streamer: FakeMessageStreamer, fs: MemoryFileSystem, bus: RecordingBus, defaultAction: PermissionActionName = 'ask', conversationState: StubConversationState = new StubConversationState()) {
  const services = createServiceCollection();
  services.register(IDurableConfigProvider).using(() => new FakeDurableConfigProvider()).asSelf().singleton();
  services.register(EmptyDisabledTools).as(IDisabledToolsProvider).singleton();
  services.register(NoopWakeLock).as(IWakeLock).singleton();
  services.register(NoopToolBlockNotifier).as(IToolBlockNotifier).singleton();
  services.register(IMessageStreamer).using(() => streamer).asSelf().singleton();
  services.register(NoopLogger).as(ILogger).singleton();
  services.register(IBus).using(() => bus).asSelf().singleton();
  services.register(AuditWriter).asSelf().singleton();
  services.register(IHistoryWriter).using(() => new NoopHistoryWriter()).asSelf().singleton();
  services.register(MemoryFileSystem).using(() => fs).asSelf().as(IFileSystem).singleton();
  services.register(Clock).using(() => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC)).asSelf().singleton();
  services.register(ISleepProvider).using(() => ({ sleep: async () => {} }) satisfies ISleepProvider).asSelf().singleton();
  services.register(IRandomProvider).using(() => ({ next: () => 0.5 }) satisfies IRandomProvider).asSelf().singleton();
  // ConfigLoader's config value is only ever read for `.permissions` here (buildPermissionMatrix) —
  // Ask across the board, so a tool call in these tests always reaches the local-approval path.
  const permissions = { default: { read: defaultAction, write: defaultAction, delete: defaultAction }, outside: { read: defaultAction, write: defaultAction, delete: defaultAction } };
  services
    .register(ConfigLoader)
    .using(() => new ConfigLoader({ config: { permissions }, sources: [], warnings: [] }))
    .asSelf()
    .singleton();
  services.register(StatusState).using(() => new StatusState('test')).asSelf().singleton();
  services.register(StubConversationState).using(() => conversationState).as(IConversationState).singleton();
  return services.buildProvider();
}

describe('Subagent — end-to-end smoke test', () => {
  it('runs a fake model turn and captures the assistant text as the result', async () => {
    const streamer = new FakeMessageStreamer([textStreamEvents('the answer is 42')]);
    const fs = new MemoryFileSystem({}, '/home/user', '/project');
    const bus = new RecordingBus();
    const provider = buildRootProvider(streamer, fs, bus);
    const getSiblingTools = (): AnyToolDefinition[] => [];

    const tool = createSubagentTool({ getProvider: () => provider, logger: new NoopLogger(), fs, approvalHolder: new AutoApproveHolder(), toolApprovalState: new ToolApprovalState(), getSiblingTools, getPermissionTools: () => [] });

    type SubagentInput = { intent: string; prompt: string; cwd: string };
    const handler = tool.handler as unknown as (input: SubagentInput, signal?: AbortSignal) => Promise<{ textContent: unknown }>;
    const actual = await handler({ intent: 'smoke test', prompt: 'what is the answer', cwd: '/project' }, undefined);

    expect(actual.textContent).toEqual({ result: 'the answer is 42', conversationId: expect.any(String), timedOut: false });
  });

  it('publishes conv deltas to the bus keyed by its own conversationId', async () => {
    const streamer = new FakeMessageStreamer([textStreamEvents('hello')]);
    const fs = new MemoryFileSystem({}, '/home/user', '/project');
    const bus = new RecordingBus();
    const provider = buildRootProvider(streamer, fs, bus);
    const getSiblingTools = (): AnyToolDefinition[] => [];

    const tool = createSubagentTool({ getProvider: () => provider, logger: new NoopLogger(), fs, approvalHolder: new AutoApproveHolder(), toolApprovalState: new ToolApprovalState(), getSiblingTools, getPermissionTools: () => [] });
    type SubagentInput = { intent: string; prompt: string; cwd: string };
    const handler = tool.handler as unknown as (input: SubagentInput, signal?: AbortSignal) => Promise<{ textContent: { conversationId: string } }>;
    const actual = await handler({ intent: 'smoke test', prompt: 'say hello', cwd: '/project' }, undefined);

    const expected = true;
    const delta = bus.published.find((p) => p.subject === `conv.v2.${actual.textContent.conversationId}.deltas`);
    expect(delta !== undefined).toBe(expected);
  });

  it('prints a notice block with tokens/cost in the parent transcript on a subagent usage event', async () => {
    const streamer = new FakeMessageStreamer([textStreamEvents('hello')]);
    const fs = new MemoryFileSystem({}, '/home/user', '/project');
    const bus = new RecordingBus();
    const conversationState = new StubConversationState();
    const provider = buildRootProvider(streamer, fs, bus, 'ask', conversationState);
    const getSiblingTools = (): AnyToolDefinition[] => [];

    const tool = createSubagentTool({ getProvider: () => provider, logger: new NoopLogger(), fs, approvalHolder: new AutoApproveHolder(), toolApprovalState: new ToolApprovalState(), getSiblingTools, getPermissionTools: () => [] });
    type SubagentInput = { intent: string; prompt: string; cwd: string };
    const handler = tool.handler as unknown as (input: SubagentInput, signal?: AbortSignal) => Promise<{ textContent: unknown }>;
    await handler({ intent: 'smoke test', prompt: 'say hello', cwd: '/project' }, undefined);

    const expected = true;
    const actual = conversationState.received.some((b) => typeof (b as { content?: string }).content === 'string' && (b as { content: string }).content.includes('subagent: [') && (b as { content: string }).content.includes('tokens') && (b as { content: string }).content.includes('$'));
    expect(actual).toBe(expected);
  });

  it('reports timedOut and never writes an audit file when the timeout cuts the run short', async () => {
    // A streamer that never yields on its own — the same way a real fetch-backed stream, it only
    // ends when the abort signal fires, which is exactly what the timeout is supposed to trigger.
    class NeverStreams extends IMessageStreamer {
      public stream(_body: BetaMessageStreamParams, options: Anthropic.RequestOptions): SdkMessageStream {
        const signal = options.signal as AbortSignal | undefined;
        return (async function* () {
          await new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('aborted')));
          });
        })();
      }
    }
    const streamer = new NeverStreams();
    const fs = new MemoryFileSystem({}, '/home/user', '/project');
    const bus = new RecordingBus();
    const provider = buildRootProvider(streamer as unknown as FakeMessageStreamer, fs, bus);
    const getSiblingTools = (): AnyToolDefinition[] => [];

    const tool = createSubagentTool({ getProvider: () => provider, logger: new NoopLogger(), fs, approvalHolder: new AutoApproveHolder(), toolApprovalState: new ToolApprovalState(), getSiblingTools, getPermissionTools: () => [] });
    type SubagentInput = { intent: string; prompt: string; cwd: string; timeoutMs: number };
    const handler = tool.handler as unknown as (input: SubagentInput, signal?: AbortSignal) => Promise<{ textContent: { result: string; conversationId: string; timedOut: boolean } }>;
    const actual = await handler({ intent: 'smoke test', prompt: 'this will never finish', cwd: '/project', timeoutMs: 1 }, undefined);

    expect(actual.textContent.timedOut).toBe(true);
    expect(actual.textContent.result).toContain('timed out after 1ms');
  });

  it('runs a tool call approved through the local ToolApprovalState, not the wire', async () => {
    const streamer = new FakeMessageStreamer([toolUseStreamEvents('toolu_1', 'Echo', '{"text":"hi"}'), textStreamEvents('done: hi')]);
    const fs = new MemoryFileSystem({}, '/home/user', '/project');
    const bus = new RecordingBus();
    const provider = buildRootProvider(streamer, fs, bus);
    const echoTool: AnyToolDefinition = {
      name: 'Echo',
      description: 'echoes text',
      input_schema: z.object({ text: z.string() }),
      output_schema: z.object({ text: z.string() }),
      input_examples: [],
      handler: async (input: { text: string }) => ({ textContent: { text: input.text } }),
    };
    const toolApprovalState = new ToolApprovalState();

    const tool = createSubagentTool({ getProvider: () => provider, logger: new NoopLogger(), fs, approvalHolder: new NeverAnswersHolder(), toolApprovalState, getSiblingTools: () => [echoTool], getPermissionTools: () => [{ name: 'Echo', operation: 'write' }] });

    type SubagentInput = { intent: string; prompt: string; cwd: string };
    const handler = tool.handler as unknown as (input: SubagentInput, signal?: AbortSignal) => Promise<{ textContent: unknown }>;
    const resultPromise = handler({ intent: 'smoke test', prompt: 'echo hi', cwd: '/project' }, undefined);

    // Wait for the tool call to actually reach the local approval queue, then approve it there —
    // the wire (NeverAnswersHolder) never will, so this proves the local path is what settles it.
    await vi.waitFor(() => expect(toolApprovalState.hasPendingTools).toBe(true));
    toolApprovalState.resolveSelected(true);

    const actual = await resultPromise;
    expect(actual.textContent).toEqual({ result: 'done: hi', conversationId: expect.any(String), timedOut: false });
  });

  it('never asks at all for a tool the permission matrix auto-approves', async () => {
    const streamer = new FakeMessageStreamer([toolUseStreamEvents('toolu_2', 'Echo', '{"text":"hi"}'), textStreamEvents('done: hi')]);
    const fs = new MemoryFileSystem({}, '/home/user', '/project');
    const bus = new RecordingBus();
    const provider = buildRootProvider(streamer, fs, bus, 'approve');
    const echoTool: AnyToolDefinition = {
      name: 'Echo',
      description: 'echoes text',
      input_schema: z.object({ text: z.string() }),
      output_schema: z.object({ text: z.string() }),
      input_examples: [],
      handler: async (input: { text: string }) => ({ textContent: { text: input.text } }),
    };
    const toolApprovalState = new ToolApprovalState();

    // Never answers on the wire and never gets a local resolveSelected() call either — if the tool
    // ever actually asks, this test hangs (or the assertion below on hasPendingTools fails), proving
    // the auto-approve path settled it without raising anything, the same as AgentMessageHandler's own.
    const tool = createSubagentTool({ getProvider: () => provider, logger: new NoopLogger(), fs, approvalHolder: new NeverAnswersHolder(), toolApprovalState, getSiblingTools: () => [echoTool], getPermissionTools: () => [{ name: 'Echo', operation: 'read' }] });

    type SubagentInput = { intent: string; prompt: string; cwd: string };
    const handler = tool.handler as unknown as (input: SubagentInput, signal?: AbortSignal) => Promise<{ textContent: unknown }>;
    const actual = await handler({ intent: 'smoke test', prompt: 'echo hi', cwd: '/project' }, undefined);

    const expected = { result: 'done: hi', conversationId: expect.any(String), timedOut: false };
    expect(actual.textContent).toEqual(expected);
    expect(toolApprovalState.hasPendingTools).toBe(false);
  });
});
