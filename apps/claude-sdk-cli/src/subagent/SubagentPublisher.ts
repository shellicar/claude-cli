import type { Clock } from '@js-joda/core';
import { ApprovalCoordinator, type DurableConfig, IConversation, ISdkMessagePublisher, type SdkMessage } from '@shellicar/claude-sdk';
import type { ApprovalCorrelation, IApprovalHolder, Settlement } from '../approval/ApprovalHolder.js';
import type { IBus } from '../bus/IBus.js';
import { telemetryLeaf } from '../conv/telemetryLeaf.js';
import { encode, stamp } from '../conv/wire.js';
import type { IToolApprovalState } from '../model/ToolApprovalState.js';
import { projectSubagentTelemetry } from './subagentTelemetry.js';

/**
 * The child query's outbound message sink for one Subagent run: SdkEventBridge's role, re-cut for a
 * subagent's own scope. Collects the last turn's text as the answer, races tool approval over the
 * wire and the shared local ToolApprovalState (a subagent has no screen of its own — same two
 * surfaces the parent's own tool calls use), and publishes deltas/telemetry to `conv.v2.<id>.*` on
 * the bus the same shape a real conversation would, keyed by this subagent's own conversationId.
 */
export class SubagentPublisher extends ISdkMessagePublisher {
  #buffer = '';
  #result = '';
  readonly #toolNames = new Map<string, string>();

  public constructor(
    private readonly conversationId: string,
    private readonly approvalHolder: IApprovalHolder,
    private readonly toolApprovalState: IToolApprovalState,
    private readonly approval: ApprovalCoordinator,
    private readonly bus: IBus,
    private readonly clock: Clock,
    private readonly conversation: IConversation,
    private readonly config: DurableConfig,
  ) {
    super();
  }

  public get result(): string {
    return this.#result;
  }

  /** Same "served off the in-memory array" read as ConversationSession.conversationTip(), for a
   *  subagent's own Conversation instead of the one real session's. */
  #tip(): { queryId: string; turnId: string } | undefined {
    const identity = this.conversation.items.at(-1)?.identity;
    return identity == null ? undefined : { queryId: identity.queryId, turnId: identity.turnId };
  }

  public send(msg: SdkMessage): void {
    switch (msg.type) {
      case 'message_start':
        this.#buffer = '';
        break;
      case 'message_text':
        this.#buffer += msg.text;
        this.bus.publish(`conv.v2.${this.conversationId}.deltas`, encode({ type: 'delta', text: msg.text }));
        break;
      case 'message_end':
        this.#result = this.#buffer;
        break;
      case 'tool_approval_request':
        void this.#handleApproval(msg);
        break;
      default:
        break;
    }
    const body = projectSubagentTelemetry(msg, this.#tip(), this.config, this.#toolNames);
    if (body !== null) {
      const { leaf, rest } = telemetryLeaf(body);
      this.bus.publish(`conv.v2.${this.conversationId}.telemetry.${leaf}`, stamp(this.clock, rest));
    }
  }

  async #handleApproval(msg: Extract<SdkMessage, { type: 'tool_approval_request' }>): Promise<void> {
    const correlation: ApprovalCorrelation = { conversationId: this.conversationId, toolUseId: msg.requestId };
    this.toolApprovalState.addTool({ requestId: msg.requestId, name: msg.name, input: msg.input });
    const wireAnswer = this.approvalHolder.raise(msg, correlation);
    const localAnswer = this.toolApprovalState.requestApproval(msg.requestId).then((approved): Settlement => ({ approved, by: { kind: 'human' } }));
    const settlement = await Promise.race([wireAnswer, localAnswer]);
    this.approvalHolder.settle(msg.requestId, settlement);
    // Drain whichever side did not win: idempotent no-op if it already settled.
    this.toolApprovalState.resolveApproval(msg.requestId, settlement.approved);
    this.toolApprovalState.removeTool(msg.requestId);
    this.approval.handle({ type: 'tool_approval_response', requestId: msg.requestId, approved: settlement.approved, reason: settlement.approved ? undefined : 'denied' });
  }

  public close(): void {}

  public async drain(): Promise<void> {}
}
