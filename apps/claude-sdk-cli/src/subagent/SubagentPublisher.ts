import type { Clock } from '@js-joda/core';
import { ApprovalCoordinator, type DurableConfig, IConversation, ISdkMessagePublisher, type SdkMessage } from '@shellicar/claude-sdk';
import type { ApprovalCorrelation, IApprovalHolder, Settlement } from '../approval/ApprovalHolder.js';
import type { IBus } from '../bus/IBus.js';
import { telemetryLeaf } from '../conv/telemetryLeaf.js';
import { encode, stamp } from '../conv/wire.js';
import type { IToolApprovalState } from '../model/ToolApprovalState.js';
import { findUnknownTools, getPermission, PermissionAction, type PermissionConfig, type PermissionTool } from '../permissions.js';
import { projectSubagentTelemetry } from './subagentTelemetry.js';

/**
 * The child query's outbound message sink for one Subagent run: SdkEventBridge's role, re-cut for a
 * subagent's own scope. Collects the last turn's text as the answer, resolves tool approval through
 * the same permission matrix AgentMessageHandler#toolApprovalRequest uses (Approve/Deny settle
 * silently, only Ask actually raises a prompt), racing the wire and the shared local
 * ToolApprovalState when it does — a subagent has no screen of its own, so it uses the same two
 * surfaces the parent's own tool calls use. Publishes deltas/telemetry to `conv.v2.<id>.*` on the
 * bus the same shape a real conversation would, keyed by this subagent's own conversationId.
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
    private readonly permissionTools: readonly PermissionTool[],
    private readonly matrix: PermissionConfig,
    private readonly cwd: string,
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
    this.toolApprovalState.addTool({ requestId: msg.requestId, name: msg.name, input: msg.input });
    const perm = getPermission({ name: msg.name, input: msg.input }, this.permissionTools, this.cwd, this.matrix);

    if (perm === PermissionAction.NotFound) {
      // A lookup failure, not a decision — tell the model the real cause, never the default
      // "Rejected by user": nothing was ever raised, so there's nothing a user rejected.
      const missing = findUnknownTools({ name: msg.name, input: msg.input }, this.permissionTools);
      const reason = `Tool not found: ${missing.join(', ')}. This is a tool-lookup failure, not a user rejection.`;
      this.approval.handle({ type: 'tool_approval_response', requestId: msg.requestId, approved: false, reason });
      this.toolApprovalState.removeTool(msg.requestId);
      return;
    }

    let approved: boolean;
    let autoDenyReason: string | undefined;
    if (perm === PermissionAction.Approve) {
      approved = true;
    } else if (perm === PermissionAction.Deny) {
      approved = false;
      // Distinct from a human rejection: no prompt was shown, so "do not reattempt" is the wrong
      // signal — name the cause plainly so the model can adjust rather than reading it as a refusal.
      autoDenyReason = `Auto-denied by permission policy (not a user decision): ${msg.name} is configured to be denied automatically.`;
    } else {
      // Only Ask actually raises anything — auto-approve/auto-deny above never touch the wire or the
      // local queue, same as AgentMessageHandler#toolApprovalRequest.
      const correlation: ApprovalCorrelation = { conversationId: this.conversationId, toolUseId: msg.requestId };
      const wireAnswer = this.approvalHolder.raise(msg, correlation);
      const localAnswer = this.toolApprovalState.requestApproval(msg.requestId).then((a): Settlement => ({ approved: a, by: { kind: 'human' } }));
      const settlement = await Promise.race([wireAnswer, localAnswer]);
      approved = settlement.approved;
      this.approvalHolder.settle(msg.requestId, settlement); // idempotent — the local path's later settle is a no-op
      this.toolApprovalState.resolveApproval(msg.requestId, settlement.approved);
    }

    this.approval.handle({ type: 'tool_approval_response', requestId: msg.requestId, approved, ...(autoDenyReason ? { reason: autoDenyReason } : {}) });
    this.toolApprovalState.removeTool(msg.requestId);
  }

  public close(): void {}

  public async drain(): Promise<void> {}
}
