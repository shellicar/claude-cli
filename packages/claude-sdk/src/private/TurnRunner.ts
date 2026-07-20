import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaCompactionBlockParam, BetaContentBlockParam, BetaRedactedThinkingBlockParam, BetaServerToolUseBlockParam, BetaTextBlockParam, BetaThinkingBlockParam, BetaToolUseBlockParam } from '@anthropic-ai/sdk/resources/beta.mjs';
import { Clock, Duration, type Instant } from '@js-joda/core';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IRandomProvider } from '@shellicar/claude-core/providers/IRandomProvider';
import { ISleepProvider } from '@shellicar/claude-core/providers/ISleepProvider';
import { dependsOn } from '@shellicar/core-di-lite';
import { IStreamProcessor, ITurnRunner, IWakeLock } from '../public/interfaces';
import type { ContentBlock, DurableConfig, SystemReminder, TurnInput } from '../public/types';
import { AccountLimitListener, IRequestClockListener, StreamInterruptListener } from '../public/types';
import { ACCOUNT_LIMIT_BUDGET_MS, calculateBackoffDelay, isAccountLimit, isRetryable, MAX_RETRIES, RETRY_AFTER_CAP_MS, STREAM_INTERRUPT_DELAY_MS, STREAM_INTERRUPT_MAX_RETRIES } from './backoff';
import type { Conversation } from './Conversation';
import { buildReminderBlocks, ensureClaudeMdReminders } from './claudeMdReminders';
import { formatClockStamp } from './clockStamp';
import { AccountLimitStoppedError, StreamInterruptedError } from './http/errors';
import { IMessageStreamer } from './MessageStreamer';
import { assistantIdentity } from './messageIdentity';
import { buildRequestParams, type RequestBuilderOptions } from './RequestBuilder';
import type { MessageStreamResult } from './types';

/**
 * Long-lived turn runner. Constructed once at consumer setup with its
 * dependencies (`IMessageStreamer` and `IStreamProcessor`) and reused for
 * every turn of every query.
 *
 * A turn is one request-and-response cycle between the SDK and the Anthropic
 * API. Per call to `run` the runner:
 *
 * 1. Reads the wire view from `Conversation.cloneForRequest()`.
 * 2. Builds `RequestBuilderOptions` from the durable config plus the
 *    per-turn `systemReminder`.
 * 3. Calls the pure `buildRequestParams` function to get `{ body, headers }`.
 * 4. Merges the per-turn abort signal into `Anthropic.RequestOptions`.
 * 5. Calls the injected streamer to get the raw event iterable.
 * 6. Hands the iterable to the injected stream processor and awaits the
 *    assembled `MessageStreamResult`.
 * 7. Maps the result's internal `ContentBlock[]` to the wire-format
 *    `BetaContentBlockParam[]` and, if non-empty, pushes the assembled
 *    assistant message into the `Conversation`.
 * 8. Returns the full result so the query runner can read `stopReason`,
 *    `blocks` (for tool dispatch), and `usage` (for the channel).
 *
 * The runner does not subscribe or unsubscribe to any events per turn. The
 * `.on(...)` handlers on the injected `IStreamProcessor` were set by the
 * consumer once at SDK setup and fire naturally for every turn this runner
 * processes.
 *
 * Does NOT dispatch tools, construct `tool_result` messages, or decide
 * whether to loop: those are the query runner's responsibilities. The
 * runner's instance state is only its constructor-injected dependencies;
 * everything per-turn lives in `run`'s local variables.
 *
 * See `.claude/plans/sdk-refactor-playbook.md` for the original design.
 */
export class TurnRunner extends ITurnRunner {
  @dependsOn(IMessageStreamer) private readonly streamer!: IMessageStreamer;
  @dependsOn(IStreamProcessor) private readonly processor!: IStreamProcessor;
  @dependsOn(ILogger) private readonly logger!: ILogger;
  @dependsOn(AccountLimitListener) private readonly accountLimit!: AccountLimitListener;
  @dependsOn(ISleepProvider) private readonly sleeper!: ISleepProvider;
  @dependsOn(IRandomProvider) private readonly random!: IRandomProvider;
  @dependsOn(Clock) private readonly clock!: Clock;
  @dependsOn(IWakeLock) private readonly wakeLock!: IWakeLock;
  @dependsOn(StreamInterruptListener) private readonly interruption!: StreamInterruptListener;
  @dependsOn(IRequestClockListener) private readonly requestClock!: IRequestClockListener;

  public async run(conversation: Conversation, durable: DurableConfig, turnInput: TurnInput): Promise<MessageStreamResult> {
    const compactEnabled = durable.compact?.enabled ?? false;

    // Write the clock stamp into history as a leading block of the tip message, before taking the
    // request clone. Persisted, not ephemeral, and leading rather than trailing: it reads as calm
    // background context instead of the freshest thing in the request, which is what drove the
    // model to narrate it turn after turn when it sat trailing and un-persisted.
    // Only on a real ask (human/orchestrator), not an agent-authored tool_result continuation: a
    // tool loop runs seconds apart, so restamping every round trip would bake near-duplicate
    // timestamps into history for no orientation value. Missing identity (a legacy conversation)
    // is treated as a real ask, since there is nothing to say otherwise.
    if (conversation.items.at(-1)?.identity?.from.kind !== 'agent') {
      conversation.prependToLast(buildReminderBlocks([formatClockStamp(this.clock)]));
    }

    const messages = conversation.cloneForRequest(compactEnabled);

    // The request delta is the conversation tip: the trailing user-role message
    // that triggered this API call (the typed prompt on turn 1, the tool_result on
    // a tool-loop turn). Read before the assistant is pushed below, so the audit
    // lands the user/assistant pair together at final_message. cloneForRequest
    // clones a mutable copy; the stored items are untouched, so this is the
    // pristine stored user message.
    const requestDelta = conversation.items.at(-1)?.msg;
    // The tip's identity (the round's messageId/turnId/queryId), read off the same item as the delta.
    // It rides final_message to the CLI writer, which stamps the audit pair and the history index with it.
    const requestIdentity = conversation.items.at(-1)?.identity;

    // Keep the CLAUDE.md reminders present in every request, including after a
    // compaction has trimmed off the first user message that originally carried
    // them. Idempotent, so the pre-compaction request (where they are already the
    // leading blocks) is untouched.
    ensureClaudeMdReminders(messages, durable.cachedReminders);

    // Assemble per-turn ephemeral reminders: query-supplied ones only (e.g. the git delta, first
    // turn only). The clock stamp is handled above, persisted into history instead.
    const ephemeralReminders: SystemReminder[] = [...(turnInput.ephemeralReminders ?? [])];

    const builderOptions: RequestBuilderOptions = {
      model: durable.model,
      maxTokens: durable.maxTokens,
      thinking: durable.thinking,
      thinkingEffort: durable.thinkingEffort,
      tools: durable.tools,
      serverTools: durable.serverTools,
      transformTool: durable.transformTool,
      betas: durable.betas,
      systemPrompts: durable.systemPrompts,
      ephemeralReminders,
      cachedReminders: durable.cachedReminders,
      compact: durable.compact,
      cacheTtl: durable.cacheTtl,
    };
    const { body, headers } = buildRequestParams(builderOptions, messages);

    this.logger.info('Sending request', body);

    const requestOptions: Anthropic.RequestOptions = {
      headers,
      signal: turnInput.abortSignal,
    };
    let result!: MessageStreamResult;
    let firstAccountLimitAt: Instant | null = null;
    let transientAttempt = 0;
    let streamInterruptAttempt = 0;
    // Held across the whole retry loop so the machine stays awake during the
    // request and any backoff waits; released the instant the turn settles, so
    // local work between turns can still let the machine sleep. Always a handle
    // (the bound IWakeLock returns a no-op handle when disabled/unsupported).
    const wake = this.wakeLock.acquire();
    try {
      for (;;) {
        this.requestClock.requestStarted();
        try {
          const stream = this.streamer.stream(body, requestOptions);
          result = await this.processor.process(stream, requestDelta, requestIdentity);
          this.requestClock.requestSettled(true);
          break;
        } catch (err) {
          this.requestClock.requestSettled(false);
          // ESC during the request: a normal in-flight cancel, never retried.
          if (turnInput.abortSignal.aborted) {
            throw err;
          }

          // Account-limit 429 (retry-after exceeds the 60s cap): non-transient.
          // The give-up decision is made immediately after each 429, before any wait.
          if (isAccountLimit(err, RETRY_AFTER_CAP_MS)) {
            const now = this.clock.instant();
            firstAccountLimitAt ??= now;
            if (Duration.between(firstAccountLimitAt, now).toMillis() >= ACCOUNT_LIMIT_BUDGET_MS) {
              this.accountLimit.stopped();
              throw new AccountLimitStoppedError();
            }
            this.accountLimit.retrying();
            await this.sleeper.sleep(RETRY_AFTER_CAP_MS, turnInput.abortSignal);
            if (turnInput.abortSignal.aborted) {
              turnInput.abortSignal.throwIfAborted();
            }
            continue;
          }

          // Mid-stream socket death (undici `terminated`, observed on sleep/wake).
          // Own short, fixed-delay strategy: a dropped socket clears on
          // network-return time, not server-recovery time, so exponential backoff
          // is pointless. A separate counter, so it can neither be starved nor
          // extended by other transient retries.
          if (err instanceof StreamInterruptedError) {
            streamInterruptAttempt++;
            if (streamInterruptAttempt > STREAM_INTERRUPT_MAX_RETRIES) {
              throw err;
            }
            this.logger.warn('stream interrupted; reconnecting', { attempt: streamInterruptAttempt });
            this.interruption.reconnecting();
            await this.sleeper.sleep(STREAM_INTERRUPT_DELAY_MS, turnInput.abortSignal);
            if (turnInput.abortSignal.aborted) {
              turnInput.abortSignal.throwIfAborted();
            }
            continue;
          }

          // Other transient errors: existing exponential backoff + jitter, bounded.
          transientAttempt++;
          if (!isRetryable(err) || transientAttempt > MAX_RETRIES) {
            throw err;
          }
          await this.sleeper.sleep(
            calculateBackoffDelay(transientAttempt, () => this.random.next()),
            turnInput.abortSignal,
          );
          if (turnInput.abortSignal.aborted) {
            // On abort, surface a standard cancel: throwIfAborted() throws signal.reason
            // (a DOMException when abort() has no reason). Deliberately not the SDK's
            // APIUserAbortError, and need not be.
            turnInput.abortSignal.throwIfAborted();
          }
        }
      }
    } finally {
      wake.release();
    }

    const assistantContent = result.blocks.map(mapBlock);
    if (assistantContent.length > 0) {
      // The assistant inherits the round's turnId/queryId off the tip (the user-role message that opened
      // this round) and mints its own messageId. No tip identity (a legacy conversation) leaves it unstamped.
      const round = conversation.items.at(-1)?.identity;
      conversation.push({ role: 'assistant', content: assistantContent }, round ? { identity: assistantIdentity(round) } : undefined);
    }

    return result;
  }
}

function mapBlock(b: ContentBlock): BetaContentBlockParam {
  switch (b.type) {
    case 'text':
      return { type: 'text' as const, text: b.text } satisfies BetaTextBlockParam;
    case 'thinking':
      return { type: 'thinking' as const, thinking: b.thinking, signature: b.signature } satisfies BetaThinkingBlockParam;
    case 'tool_use':
      return { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input } satisfies BetaToolUseBlockParam;
    case 'compaction':
      return { type: 'compaction' as const, content: b.content } satisfies BetaCompactionBlockParam;
    case 'server_tool_use': {
      const name = b.name as BetaServerToolUseBlockParam['name'];
      return { type: 'server_tool_use' as const, id: b.id, name, input: b.input } satisfies BetaServerToolUseBlockParam;
    }
    case 'redacted_thinking':
      return { type: 'redacted_thinking' as const, data: b.data } satisfies BetaRedactedThinkingBlockParam;
    case 'web_search_tool_result':
    case 'web_fetch_tool_result':
    case 'code_execution_tool_result':
    case 'bash_code_execution_tool_result':
    case 'text_editor_code_execution_tool_result':
    case 'tool_search_tool_result':
    case 'mcp_tool_result':
      return { type: b.type, tool_use_id: b.toolUseId, content: b.content } as BetaContentBlockParam;
  }
}
