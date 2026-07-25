import { Clock } from '@js-joda/core';
import { type SdkMessage, StreamProcessor } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { AuditWriter } from '../AuditWriter.js';
import { IBus } from '../bus/IBus.js';
import { AgentMessageHandler } from '../controller/AgentMessageHandler.js';
import { IConvTelemetryProjector } from '../conv/ConvTelemetryProjector.js';
import { telemetryLeaf } from '../conv/telemetryLeaf.js';
import { encode, stamp } from '../conv/wire.js';
import { IConversationSession } from '../model/ConversationSession.js';
import { SdkChannel } from './SdkChannel.js';

/** A round's closing reason, recognised off its telemetry but not committal until the closing
 *  message has landed on `changes` — the turn-execution seam reads this via `takePendingQueryClose`. */
export type PendingQueryClose = { queryId: string; reason: 'completed' | 'aborted' };

/** The bridge's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class ISdkEventBridge {
  public abstract wire(): void;
  public abstract takePendingQueryClose(): PendingQueryClose | null;
}

/**
 * Translates the SDK's two event surfaces into the CLI's own wire concerns: `StreamProcessor`'s
 * per-frame events become `SdkChannel` sends (for `AgentMessageHandler`'s display projection), and
 * `SdkChannel`'s assembled messages drive the audit write, the conv delta/telemetry publish, and the
 * pending-query-close recognition that turn execution consumes after its own flush.
 *
 * Was inline in `main.ts`'s `runApp` — main resolved every one of these dependencies itself and wired
 * the listeners by hand, a service-locator pattern that (unlike a real `@dependsOn` class) is invisible
 * to `buildContainer(...).validate()`. Extracted so this wiring is graph-checked like everything else.
 */
export class SdkEventBridge extends ISdkEventBridge {
  @dependsOn(StreamProcessor) private readonly processor!: StreamProcessor;
  @dependsOn(SdkChannel) private readonly sdkChannel!: SdkChannel;
  @dependsOn(AuditWriter) private readonly auditWriter!: AuditWriter;
  @dependsOn(AgentMessageHandler) private readonly handler!: AgentMessageHandler;
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(IConvTelemetryProjector) private readonly convTelemetry!: IConvTelemetryProjector;
  @dependsOn(Clock) private readonly clock!: Clock;
  @dependsOn(IConversationSession) private readonly session!: IConversationSession;
  #pendingQueryClose: PendingQueryClose | null = null;

  /** Wire both directions. Call once at startup, after every dependency above is live. */
  public wire(): void {
    this.processor.on('final_message', (msg, request, identity) => this.auditWriter.write(this.session.id, request, msg, identity));
    this.processor.on('message_start', () => this.sdkChannel.send({ type: 'message_start' }));
    this.processor.on('message_usage', (usage) => this.sdkChannel.send({ type: 'message_usage', ...usage }));
    this.processor.on('message_text', (text) => this.sdkChannel.send({ type: 'message_text', text }));
    this.processor.on('thinking_text', (text) => this.sdkChannel.send({ type: 'message_thinking', text }));
    this.processor.on('message_stop', (stopReason) => this.sdkChannel.send({ type: 'message_end', stopReason }));
    this.processor.on('compaction_complete', (summary) => this.sdkChannel.send({ type: 'message_compaction', summary }));
    this.processor.on('server_tool_use', (id, name, input) => this.sdkChannel.send({ type: 'server_tool_use', id, name, input }));
    this.processor.on('server_tool_result', (id, name, result) => this.sdkChannel.send({ type: 'server_tool_result', id, name, result }));
    this.processor.on('tool_use_start', (id, name) => this.sdkChannel.send({ type: 'tool_use_start', id, name }));
    this.processor.on('server_tool_use_start', (id, name) => this.sdkChannel.send({ type: 'server_tool_use_start', id, name }));
    this.processor.on('tool_use_input_delta', (id, partialJson) => this.sdkChannel.send({ type: 'tool_use_input_delta', id, partialJson }));
    this.processor.on('tool_use_input_stop', (id, input) => this.sdkChannel.send({ type: 'tool_use_input_stop', id, input }));
    this.processor.on('enter_block', (blockType) => this.sdkChannel.send({ type: 'block_enter', blockType }));
    this.processor.on('exit_block', (blockType) => this.sdkChannel.send({ type: 'block_exit', blockType }));
    this.processor.on('tool_batch_start', () => this.sdkChannel.send({ type: 'tool_batch_start' }));
    this.processor.on('tool_batch_end', () => this.sdkChannel.send({ type: 'tool_batch_end' }));

    this.sdkChannel.subscribe(async (msg: SdkMessage) => {
      this.handler.handle(msg);
      // Deltas are the streaming assistant text, published bare (the spec waives the envelope `ts` for them).
      if (msg.type === 'message_text') {
        this.bus.publish(`conv.v2.${this.session.id}.deltas`, encode({ type: 'delta', text: msg.text }));
      }
      const body = this.convTelemetry.fromSdk(msg);
      if (body !== null) {
        const { leaf, rest } = telemetryLeaf(body);
        this.bus.publish(`conv.v2.${this.session.id}.telemetry.${leaf}`, stamp(this.clock, rest));
        // A turn's own end is committal fact once its message lands on `changes` (flushed at turn-execution's
        // end) — end_turn closes the query then, here we only recognise the reason to carry forward.
        if (body.type === 'turn_ended' && body.stopReason === 'end_turn') {
          this.#pendingQueryClose = { queryId: body.queryId, reason: 'completed' };
        } else if (body.type === 'turn_aborted') {
          this.#pendingQueryClose = { queryId: body.queryId, reason: 'aborted' };
        }
      }
    });
  }

  /** Returns and clears the pending close, if any. Consumed once per turn, after that turn's flush. */
  public takePendingQueryClose(): PendingQueryClose | null {
    const pending = this.#pendingQueryClose;
    this.#pendingQueryClose = null;
    return pending;
  }
}
