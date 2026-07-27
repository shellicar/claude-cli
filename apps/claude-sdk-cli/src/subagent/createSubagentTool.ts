import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Clock } from '@js-joda/core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import {
  AccountLimitListener,
  ApprovalCoordinator,
  type AnyToolDefinition,
  Conversation,
  defineTool,
  type DurableConfig,
  IConversation,
  IDisabledToolsProvider,
  IDurableConfigProvider,
  IQueryRunner,
  IRequestClockListener,
  ISdkMessagePublisher,
  IStreamProcessor,
  IToolRegistry,
  IToolsClockListener,
  ITurnRunner,
  QueryRunner,
  StreamInterruptListener,
  StreamProcessor,
  ToolRegistry,
  TurnRunner,
} from '@shellicar/claude-sdk';
import { VirtualAgentContext } from '@shellicar/claude-sdk-tools/fs';
import type { IServiceProvider } from '@shellicar/core-di';
import { z } from 'zod';
import type { IApprovalHolder } from '../approval/ApprovalHolder.js';
import { AuditWriter } from '../AuditWriter.js';
import { IBus } from '../bus/IBus.js';
import type { IToolApprovalState } from '../model/ToolApprovalState.js';
import { buildPermissionMatrix, type PermissionTool } from '../permissions.js';
import { StaticDurableConfigProvider } from './StaticDurableConfigProvider.js';
import { SubagentPublisher } from './SubagentPublisher.js';

// A subagent's own account-limit/stream-interrupt/clock signals are its own sub-turn, not the
// parent's — they must never touch the parent's single ConversationState/ITurnClock (which
// render and time the ONE status line and transcript for the parent's own turns).
class NoopRequestClockListener extends IRequestClockListener {
  public requestStarted(): void {}
  public requestSettled(): void {}
}
class NoopToolsClockListener extends IToolsClockListener {
  public toolsStarted(): void {}
  public toolsStopped(): void {}
}
class NoopAccountLimitListener extends AccountLimitListener {
  public retrying(): void {}
  public stopped(): void {}
}
class NoopStreamInterruptListener extends StreamInterruptListener {
  public reconnecting(): void {}
}

export const SUBAGENT_TOOL_NAME = 'Subagent';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const inputSchema = z.object({
  intent: z.string().describe('Why this subagent is being spawned — shown to whoever approves its tool calls.'),
  prompt: z.string().describe('The one-shot task for the subagent. It gets no follow-up message and cannot be talked to again.'),
  cwd: z.string().describe('Absolute working directory for the subagent. Never inherited implicitly from the parent.'),
  timeoutMs: z.number().int().positive().optional().describe(`Hard wall-clock cap in ms, after which the subagent is aborted. Defaults to ${DEFAULT_TIMEOUT_MS}.`),
});

// result and conversationId are kept as separate top-level fields (not concatenated into one
// string) so a large result gets ref-swapped without taking conversationId with it — see
// RefStore.walkAndRef, which swaps per-field, not the whole object.
const outputSchema = z.object({
  result: z.string(),
  conversationId: z.string(),
});

export type CreateSubagentToolOptions = {
  /** A thunk to the app's built root provider — called only inside the handler below, once the
   *  tool is actually invoked, never at construction time (see RootProviderBox in container.ts:
   *  AppToolsService, which builds this tool, is itself constructed eagerly during buildProvider(),
   *  before the root provider object exists). A subagent opens its own scope on it: Conversation,
   *  ToolRegistry, ApprovalCoordinator, IDurableConfigProvider, ISdkMessagePublisher,
   *  IStreamProcessor, ITurnRunner and IQueryRunner are registered fresh on that scope, shadowing
   *  the root's own (main-session) registrations only within it; every other dependency
   *  (IMessageStreamer, ISleepProvider, IRandomProvider, Clock, IWakeLock, IDisabledToolsProvider,
   *  IToolBlockNotifier, AuditWriter, IBus) falls through to the root's shared singleton, since a
   *  scope "shares singletons with the whole provider" (core-di). */
  getProvider: () => IServiceProvider;
  logger: ILogger;
  fs: IFileSystem;
  approvalHolder: IApprovalHolder;
  /** The same singleton the parent's UI renders pending approvals from — keyed by request id,
   *  not by conversation, so a subagent's ask is just another entry in the one queue. */
  toolApprovalState: IToolApprovalState;
  /** The full, live tool list the parent was built with, read at call time so a subagent
   *  never sees a stale snapshot. Filtered to exclude Subagent itself — the recursion guard. */
  getSiblingTools: () => AnyToolDefinition[];
  /** The same permissionTools projection (tools + pipe stages) the parent's own
   *  getPermission() call reads — read at call time for the same reason as getSiblingTools. */
  getPermissionTools: () => readonly PermissionTool[];
};

/**
 * A one-shot, isolated subagent: its own Conversation, ToolRegistry (cwd-scoped via a
 * VirtualAgentContext), ApprovalCoordinator, StreamProcessor/TurnRunner/QueryRunner — all
 * scope-local, everything else shared with the real session. Its DurableConfig is cloned from the
 * parent's live one (systemPrompts, betas, model, etc. all inherited), with `tools` overridden to
 * the child's own list. Tool approvals route through IApprovalHolder (the wire) and the shared
 * ToolApprovalState (the local UI) — a subagent has no screen of its own. Emits deltas/telemetry to
 * `conv.v2.<its-own-id>.*` on the bus and writes its own audit file, the same shape a real
 * conversation would, via its own conversationId — see SubagentPublisher.
 */
export function createSubagentTool(options: CreateSubagentToolOptions): AnyToolDefinition {
  const { getProvider, logger, fs, approvalHolder, toolApprovalState, getSiblingTools, getPermissionTools } = options;

  return defineTool({
    name: SUBAGENT_TOOL_NAME,
    operation: 'write',
    description:
      'Run a one-shot, self-contained subagent for a bounded task, isolated from your own context — its exploration never enters your window, only its final answer does. It gets exactly one prompt, no follow-up, and cannot spawn subagents of its own. Give it an explicit cwd (never inherited) and a clear intent, since intent is what an approver sees before granting any tool call it makes.',
    input_schema: inputSchema,
    output_schema: outputSchema,
    input_examples: [
      {
        intent: 'audit the exec-core package for missing tests',
        prompt: 'Read every source file under packages/exec-core/src and list functions with no corresponding test file.',
        cwd: '/Users/stephen/repos/@shellicar/claude-cli--subagent',
      },
    ],
    handler: async (input, signal) => {
      const conversationId = randomUUID();
      using scope = getProvider().createScope();

      const agentContext = new VirtualAgentContext(input.cwd);
      const expand = (p: string) => path.resolve(agentContext.cwd(), expandPath(p, fs, agentContext));

      const childTools = getSiblingTools().filter((t) => t.name !== SUBAGENT_TOOL_NAME);
      const disabledToolsProvider = scope.resolve(IDisabledToolsProvider);
      const registry = new ToolRegistry(childTools, logger, expand, disabledToolsProvider);
      scope.Services.register(ToolRegistry)
        .using(() => registry)
        .as(IToolRegistry)
        .scoped()
        .shadow();

      // Safe to resolve now: this is an already-built singleton reached from a scope, not from
      // inside AppToolsService's own factory (which is what made this circular before scopes).
      const parentConfig = scope.resolve(IDurableConfigProvider).config;
      const childConfig: DurableConfig = { ...parentConfig, tools: childTools };
      const durableProvider = new StaticDurableConfigProvider(childConfig);
      scope.Services.register(StaticDurableConfigProvider)
        .using(() => durableProvider)
        .as(IDurableConfigProvider)
        .scoped()
        .shadow();

      const conversation = new Conversation();
      scope.Services.register(Conversation)
        .using(() => conversation)
        .as(IConversation)
        .scoped()
        .shadow();

      const coordinator = new ApprovalCoordinator();
      scope.Services.register(ApprovalCoordinator)
        .using(() => coordinator)
        .asSelf()
        .scoped()
        .shadow();

      const bus = scope.resolve<IBus>(IBus);
      const clock = scope.resolve<Clock>(Clock);
      // The same permission matrix AgentMessageHandler#toolApprovalRequest consults, read live so a
      // config hot-reload takes effect on the subagent's next call, same as the parent's own.
      const matrix = buildPermissionMatrix(scope.resolve(ConfigLoader).config.permissions);
      const publisher = new SubagentPublisher(conversationId, approvalHolder, toolApprovalState, coordinator, bus, clock, conversation, childConfig, getPermissionTools(), matrix, agentContext.cwd());
      scope.Services.register(SubagentPublisher)
        .using(() => publisher)
        .as(ISdkMessagePublisher)
        .scoped()
        .shadow();

      scope.Services.register(NoopToolsClockListener).as(IToolsClockListener).scoped().shadow();
      scope.Services.register(NoopRequestClockListener).as(IRequestClockListener).scoped().shadow();
      scope.Services.register(NoopAccountLimitListener).as(AccountLimitListener).scoped().shadow();
      scope.Services.register(NoopStreamInterruptListener).as(StreamInterruptListener).scoped().shadow();

      // Single-call-at-a-time (its own docstring): reusing the parent's shared instance would
      // interleave this subagent's stream events with the parent's (or a sibling subagent's).
      scope.Services.register(StreamProcessor).as(IStreamProcessor).scoped().shadow();
      scope.Services.register(TurnRunner).as(ITurnRunner).scoped().shadow();
      scope.Services.register(QueryRunner).as(IQueryRunner).scoped().shadow();

      const queryRunner = scope.resolve(IQueryRunner);
      const processor = scope.resolve(IStreamProcessor);
      const auditWriter = scope.resolve(AuditWriter);

      // Everything except the raw audit write flows through the publisher — see SubagentPublisher
      // for the deltas/telemetry/result-capture/approval-race logic that mirrors SdkEventBridge.
      processor.on('final_message', (msg, request, identity) => auditWriter.write(conversationId, request, msg, identity));
      processor.on('message_start', () => publisher.send({ type: 'message_start' }));
      processor.on('message_usage', (usage) => publisher.send({ type: 'message_usage', ...usage }));
      processor.on('message_text', (text) => publisher.send({ type: 'message_text', text }));
      processor.on('thinking_text', (text) => publisher.send({ type: 'message_thinking', text }));
      processor.on('message_stop', (stopReason) => publisher.send({ type: 'message_end', stopReason }));
      processor.on('tool_use_start', (id, name) => publisher.send({ type: 'tool_use_start', id, name }));
      processor.on('tool_use_input_stop', (id, toolInput) => publisher.send({ type: 'tool_use_input_stop', id, input: toolInput }));

      const abortController = new AbortController();
      const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timer = setTimeout(() => abortController.abort(), timeoutMs);
      const onParentAbort = () => abortController.abort();
      signal?.addEventListener('abort', onParentAbort);

      try {
        await queryRunner.run({ messages: [input.prompt], abortController });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onParentAbort);
      }

      return { textContent: { result: publisher.result, conversationId } };
    },
  });
}
