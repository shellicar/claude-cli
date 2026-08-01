import EventEmitter from 'node:events';
import type { BetaMessageParam, BetaTool } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { IConversation, MessageIdentity } from '../private/Conversation';
import type { IMessageStream } from '../private/MessageStreamer';
import type { MessageStreamEvents, MessageStreamResult } from '../private/types';
import type { DurableConfig, PerQueryInput, ToolOutcome, ToolResolveResult, TurnInput, WakeLockHandle } from './types';

/**
 * Long-lived stream processor. A concrete implementation is constructed once
 * at consumer setup, reused for every stream, and exposes `.on(...)` events
 * that the consumer subscribes to once at setup. Per-stream state lives in
 * the `process` method's local variables, not on the instance.
 *
 * Concurrent `process` calls on the same instance are not supported; the
 * intended usage is one call at a time.
 */
export abstract class IStreamProcessor extends EventEmitter<MessageStreamEvents> {
  public abstract process(stream: IMessageStream, request?: BetaMessageParam, identity?: MessageIdentity): Promise<MessageStreamResult>;
}

/**
 * Long-lived tool registry. Holds tool definitions, validates tool-use input,
 * and exposes the handler via a `run` closure returned from `resolve`.
 *
 * Constructed once at consumer setup with the tool definitions. Converts each
 * tool's Zod schema to JSON Schema ONCE at construction and caches the
 * result: `wireTools` returns the cached wire-format representation for the
 * request builder, and `resolve` uses the cached Zod schema for per-call
 * validation.
 *
 * `resolve` is a two-phase API, split so the query runner can gate handler
 * execution on approval without a second `safeParse`:
 *
 * 1. Caller invokes `resolve(name, input)`. The registry looks the tool up,
 *    parses the input against the Zod schema, and returns either an error
 *    (`unavailable` or `rejected`) or a `ready` result carrying a `run`
 *    closure. The closure captures the parsed input at this point.
 * 2. The query runner holds the `run` closure across the approval gate and,
 *    once approval has settled, invokes it with the optional transform hook.
 *    The handler is called with the parsed input directly; no second parse.
 *
 * The registry does NOT construct full `tool_result` blocks. Wrapping the
 * `ToolRunResult` content with a `tool_use_id` is the query runner's job,
 * because only the query runner has seen the corresponding `tool_use` block.
 *
 * `resolve` returns `ready`, `unavailable`, or `rejected`; the `run` closure
 * returns `ok`, `refused`, `failed`, or `cancelled`. All the terminal kinds share
 * one `ToolOutcome` taxonomy, and the query runner keeps `unavailable` silent on
 * the channel while the other error categories broadcast.
 */
export abstract class IToolRegistry {
  public abstract get wireTools(): BetaTool[];
  public abstract resolve(name: string, input: unknown): ToolResolveResult;
  /** Replace every isPath-marked field in the raw tool input, in place, with its normalised value,
   *  before the display, permission, and handler consumers read it. */
  public abstract normaliseInputPaths(name: string, input: Record<string, unknown>): void;
}

/**
 * Tools V2's dispatch seam — the one place `QueryRunner` asks "does this `tool_use` name
 * belong to V2" and, if so, routes to it instead of `IToolRegistry`. Genuinely separate from
 * V1: no `ToolRegistry`/permission-matrix involvement, own execution (`orchestrate-core`'s
 * `execute()`), own per-stage approval story via the `requestApproval` callback `QueryRunner`
 * supplies (built from its own `ApprovalCoordinator`/publisher — the callback is reused
 * plumbing, not a shared policy decision; V2 always asks per gated stage, it never consults
 * V1's read/write/delete matrix).
 *
 * `run` covers both shapes a V2 wire tool call can be: a direct call to one registered tool
 * (`name` is that tool's own name, `input` is that tool's own input) or a call to `Orchestrate`
 * itself (`name === 'Orchestrate'`, `input` is `{ stages: [...] }`). The implementation decides
 * which by name, since both ultimately reduce to the same `execute()` call over a stage list.
 */
/** Structurally compatible with orchestrate-core's own `ApprovalContext` — duck-typed rather
 *  than an actual dependency, since claude-sdk has no reason to depend on orchestrate-core
 *  directly. Carries the gated stage's own resolved `input` (not just what's piped into it),
 *  since a decision based only on the batch can never express "deny this specific command" —
 *  most stages have no upstream at all. */
/** `stagePosition`/`stageCount` are the gated stage's own 1-based place in the pipeline it was
 *  declared in, and that pipeline's total length — both counting every stage, gated or not, so a
 *  consumer can say where in the run the ask is coming from. */
/** `input` is what the stage will actually do, every variable resolved: what a decision is made
 *  against. `asWritten` is the same stage as the caller wrote it, which is what an approver is
 *  shown, since the request is published whether or not it is granted. */
export type OrchestrateApprovalContext = { name: string; operations: string[]; input: unknown; asWritten: unknown; batch: () => Promise<unknown[]>; stagePosition: number; stageCount: number };

/** One `tool_use` block's worth of a V2 batch call: its wire id (for keying the returned
 *  outcome and any per-stage approval requests back to the right block), name, and input. */
export type OrchestrateBatchItem = { id: string; name: string; input: unknown };

export abstract class IOrchestrateEngine {
  public abstract owns(name: string): boolean;
  public abstract run(name: string, input: unknown, requestApproval?: (ctx: OrchestrateApprovalContext) => Promise<boolean>, signal?: AbortSignal): Promise<ToolOutcome>;
  /** Runs every item in one round's V2 batch against a single DI scope, opened once for the
   *  whole call and disposed once every item has settled — so a tool needing a genuinely
   *  per-round-scoped resource (e.g. the TS tools' shared tsserver process) gets the same
   *  instance across every V2 tool_use in the round, not a fresh one per call. QueryRunner does
   *  no tool coordination for V2: it only supplies the batch and `requireApproval`. Every other
   *  approval concern — whether a gated stage needs asking, minting/keying its requestId per
   *  tool_use, sending the `tool_approval_request` wire message — is this engine's own job,
   *  since it already holds `ApprovalCoordinator`/the publisher directly. */
  public abstract runBatch(items: OrchestrateBatchItem[], requireApproval: boolean, signal?: AbortSignal): Promise<Map<string, ToolOutcome>>;
}

/**
 * Long-lived turn runner. Runs one request-and-response cycle between the
 * SDK and the Anthropic API per call to `run`.
 *
 * Constructed once at consumer setup with its dependencies (an `IMessageStreamer`
 * and an `IStreamProcessor`). Reused for every turn of every query. Does NOT
 * subscribe or unsubscribe to any events per turn: the `.on(...)` handlers on
 * the injected `IStreamProcessor` are set once at setup and fire naturally for
 * every turn this runner processes.
 *
 * The runner:
 * - Reads the wire view from `Conversation.cloneForRequest()`.
 * - Calls the pure `buildRequestParams` function to produce `{ body, headers }`.
 * - Merges the per-turn abort signal into the request options.
 * - Calls the streamer to get the raw event iterable.
 * - Hands the iterable to the processor and awaits the assembled result.
 * - Pushes the assembled assistant message into the `Conversation` when the
 *   content is non-empty.
 * - Returns the full `MessageStreamResult` so the query runner can read
 *   `stopReason`, `blocks` (for tool dispatch), and `usage` (for the channel).
 *
 * Does NOT dispatch tools, construct `tool_result` messages, or decide whether
 * to loop: those are the query runner's responsibilities. Holds no per-turn
 * state on the instance; everything per-turn lives in `run`'s local variables.
 */
export abstract class ITurnRunner {
  public abstract run(conversation: IConversation, durable: DurableConfig, turnInput: TurnInput): Promise<MessageStreamResult>;
}

/**
 * Long-lived query runner. Runs one query per call to `run`. A query is one
 * user ask turned into however many turns the model needs to answer it.
 *
 * Constructed once at consumer setup with its dependencies (`ITurnRunner`, a
 * `Conversation`, an `IToolRegistry`, an `ApprovalCoordinator`, an `IPublisher<SdkMessage>`,
 * and the long-lived `DurableConfig`). Reused for every query. Holds no
 * per-query state on the instance; per-query state lives in `run`'s local
 * variables.
 *
 * The query runner owns:
 * - Pushing the per-query user messages into the `Conversation`, with
 *   `cachedReminders` injection on a fresh or post-compaction conversation.
 * - The turn loop: calls `ITurnRunner.run` until a terminal stop reason or a
 *   cancel. Threads the one-shot `systemReminder` into the first turn only.
 * - Tool dispatch between turns: resolves each `tool_use` via the registry,
 *   sends approval requests over the control channel if required, and
 *   invokes the `run` closure once approval has settled. Preserves the
 *   channel asymmetry where `unavailable` is logged silently and the other
 *   error categories broadcast on the control channel.
 * - Sending `query_summary`, `message_usage`, `done`, and `error` on the
 *   control channel.
 *
 * The query runner does NOT close the control channel. The channel is
 * long-lived and owned by the consumer; closing it per query would break
 * every subsequent query on the same SDK instance.
 */
export abstract class IQueryRunner {
  public abstract run(input: PerQueryInput): Promise<void>;
}

/**
 * Holds the machine awake for the duration of an in-flight request. TurnRunner
 * acquires a lock around the request loop (including backoff waits) and releases
 * it the moment the turn settles, so the machine is free to sleep during local
 * work between turns. Implemented by the consumer; whether to engage and which OS
 * mechanism to use is the implementation's decision, made inside acquire().
 */
export abstract class IWakeLock {
  public abstract acquire(): WakeLockHandle;
}
