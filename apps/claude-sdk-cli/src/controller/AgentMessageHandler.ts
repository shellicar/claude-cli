import { relative } from 'node:path';
import { CacheTtl, type ConsumerMessage, calculateCost, type DurableConfig, type IPublisher, type SdkMessage, type SdkMessageUsage, type SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import type { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import type { logger } from '../logger.js';
import type { ApprovalNotifier } from '../model/ApprovalNotifier.js';
import type { ConversationState } from '../model/ConversationState.js';
import type { StatusState } from '../model/StatusState.js';
import type { PendingTool, ToolApprovalState } from '../model/ToolApprovalState.js';
import { ToolObject } from '../model/ToolObject.js';
import { getPermission, PermissionAction } from '../permissions.js';

// ---- helpers (unchanged from current branch) ------------------------------------

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) {
    return `${(n / 1024 / 1024).toFixed(1)}mb`;
  }
  if (n >= 1024) {
    return `${(n / 1024).toFixed(1)}kb`;
  }
  return `${n}b`;
}

function primaryArg(input: Record<string, unknown>, cwd: string): string | null {
  for (const key of ['path', 'file']) {
    if (typeof input[key] === 'string') {
      return relative(cwd, input[key] as string) || (input[key] as string);
    }
  }
  if (typeof input.url === 'string') {
    return input.url;
  }
  if (typeof input.query === 'string') {
    return input.query;
  }
  if (typeof input.pattern === 'string') {
    return input.pattern;
  }
  if (typeof input.description === 'string') {
    return input.description;
  }
  return null;
}

function formatRefSummary(input: Record<string, unknown>, store: RefStore): string {
  const id = typeof input.id === 'string' ? input.id : '';
  if (!id) {
    return 'Ref(?)';
  }
  const hint = store.getHint(id) ?? id.slice(0, 8);
  const content = store.get(id);
  if (content === undefined) {
    return `Ref(${id.slice(0, 8)}\u2026)`;
  }
  const sizeStr = fmtBytes(content.length);
  const start = typeof input.start === 'number' ? input.start : 0;
  const limit = typeof input.limit === 'number' ? input.limit : 1000;
  const end = Math.min(start + limit, content.length);
  return `Ref \u2190 ${hint} [${start}\u2013${end} / ${sizeStr}]`;
}

function formatToolSummary(name: string, input: Record<string, unknown>, cwd: string, store: RefStore): string {
  if (name === 'Ref') {
    return formatRefSummary(input, store);
  }
  if (name === 'Pipe' && Array.isArray(input.steps)) {
    const steps = (input.steps as Array<{ tool?: unknown; input?: unknown }>)
      .map((s) => {
        const tool = typeof s.tool === 'string' ? s.tool : '?';
        const stepInput = s.input != null && typeof s.input === 'object' ? (s.input as Record<string, unknown>) : {};
        const arg = primaryArg(stepInput, cwd);
        return arg ? `${tool}(${arg})` : tool;
      })
      .join(' | ');
    return steps;
  }
  const arg = primaryArg(input, cwd);
  return arg ? `${name}(${arg})` : name;
}

// ---- types ---------------------------------------------------------------

export interface AgentMessageHandlerOptions {
  config: DurableConfig;
  channel: IPublisher<ConsumerMessage>;
  cwd: string;
  store: RefStore;
  statusState: StatusState;
  notifier: ApprovalNotifier;
  conversationState: ConversationState;
  toolApprovalState: ToolApprovalState;
}

// ---- class ---------------------------------------------------------------

/**
 * Handles all SdkMessage cases: routes each message to the appropriate
 * state mutation or channel send.
 *
 * Tool rendering uses an id-keyed map of ToolObjects rebuilt into the active
 * tools block on every state change via #redrawTools. Each tool lives and
 * updates in place by id; the map is reset only when a fresh tools block opens
 * (#openToolsBlock). lastUsage drives the per-turn token-delta annotation
 * appended while a tools block is active.
 */
export class AgentMessageHandler {
  #conversation: ConversationState;
  #tools: ToolApprovalState;
  #logger: typeof logger;
  #config: DurableConfig;
  #channel: IPublisher<ConsumerMessage>;
  #cwd: string;
  #store: RefStore;
  #lastUsage: SdkMessageUsage | null = null;
  #toolObjects = new Map<string, ToolObject>();
  #toolOrder: string[] = [];
  #toolAnnotation = '';
  #statusState: StatusState;
  #notifier: ApprovalNotifier;

  public constructor(log: typeof logger, opts: AgentMessageHandlerOptions) {
    this.#conversation = opts.conversationState;
    this.#tools = opts.toolApprovalState;
    this.#logger = log;
    this.#config = opts.config;
    this.#channel = opts.channel;
    this.#cwd = opts.cwd;
    this.#store = opts.store;
    this.#statusState = opts.statusState;
    this.#notifier = opts.notifier;
  }

  public handle(msg: SdkMessage): void {
    switch (msg.type) {
      case 'query_summary': {
        const parts = [`${msg.systemPrompts} system`, `${msg.userMessages} user`, `${msg.assistantMessages} assistant`, ...(msg.thinkingBlocks > 0 ? [`${msg.thinkingBlocks} thinking`] : [])];
        this.#conversation.transitionBlock('meta');
        const deltaLine = msg.systemReminder ? `\n${msg.systemReminder}` : '';
        this.#conversation.appendStreaming(`\uD83E\uDD16 ${this.#config.model}\n${parts.join(' \u00b7 ')}${deltaLine}`);
        break;
      }
      case 'message_thinking':
        this.#conversation.transitionBlock('thinking');
        this.#conversation.appendStreaming(msg.text);
        break;
      case 'message_text':
        this.#conversation.transitionBlock('response');
        this.#conversation.appendStreaming(msg.text);
        break;
      case 'message_compaction_start':
        this.#conversation.transitionBlock('compaction');
        break;
      case 'message_compaction': {
        this.#conversation.transitionBlock('compaction');
        this.#conversation.appendStreaming(msg.summary);
        if (this.#lastUsage) {
          const used = this.#lastUsage.inputTokens + this.#lastUsage.cacheCreationTokens + this.#lastUsage.cacheReadTokens;
          const pct = ((used / this.#lastUsage.contextWindow) * 100).toFixed(1);
          const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
          this.#conversation.appendStreaming(`\n\n[compacted at ${fmt(used)} / ${fmt(this.#lastUsage.contextWindow)} (${pct}%)]`);
        }
        break;
      }
      case 'server_tool_use': {
        this.#logger.debug('server_tool_use', { id: msg.id, name: msg.name });
        const obj = this.#toolObjects.get(msg.id);
        if (obj) {
          const summary = formatToolSummary(msg.name, msg.input, this.#cwd, this.#store);
          obj.resolve(summary);
          this.#redrawTools();
        }
        break;
      }
      case 'server_tool_result':
        this.#toolObjects.get(msg.id)?.complete();
        this.#redrawTools();
        break;
      case 'tool_use_start': {
        this.#openToolsBlock();
        const clientObj = new ToolObject(msg.id, 'client', msg.name);
        this.#toolObjects.set(msg.id, clientObj);
        this.#toolOrder.push(msg.id);
        this.#redrawTools();
        break;
      }
      case 'server_tool_use_start': {
        this.#openToolsBlock();
        this.#logger.info('server_tool_use_start', { id: msg.id, name: msg.name });
        const serverObj = new ToolObject(msg.id, 'server', msg.name);
        this.#toolObjects.set(msg.id, serverObj);
        this.#toolOrder.push(msg.id);
        this.#redrawTools();
        break;
      }
      case 'tool_use_input_delta':
        this.#toolObjects.get(msg.id)?.appendInput(msg.partialJson);
        this.#redrawTools();
        break;
      case 'tool_use_input_stop': {
        // The input block is complete and the SDK has parsed it. Flip the tool from the
        // raw streamed JSON to its resolved view now — approvals are gated on the user's
        // turn, so they cannot arrive until much later.
        const obj = this.#toolObjects.get(msg.id);
        if (obj) {
          obj.resolve(formatToolSummary(obj.name, msg.input, this.#cwd, this.#store));
          this.#redrawTools();
        }
        break;
      }
      case 'tool_approval_request': {
        this.#conversation.transitionBlock('tools');
        const approvalObj = this.#toolObjects.get(msg.requestId) ?? null;
        if (approvalObj) {
          const summary = formatToolSummary(msg.name, msg.input, this.#cwd, this.#store);
          approvalObj.resolve(summary);
          this.#redrawTools();
        }
        void this.#toolApprovalRequest(msg, approvalObj);
        break;
      }
      case 'tool_error':
        this.#conversation.transitionBlock('tools');
        this.#conversation.appendStreaming(`${msg.name} error\n\`\`\`json\n${JSON.stringify(msg.input, null, 2)}\n\`\`\`\n\n${msg.error}\n`);
        break;
      case 'message_usage': {
        // Per-turn token-delta annotation, appended while a tools block is active.
        // Guarded on the active block type (not the persisted map) so a pure-text
        // turn after a tools turn does not pick up a spurious annotation.
        const prev = this.#lastUsage;
        if (this.#conversation.activeBlock?.type === 'tools' && prev !== null) {
          const prevCtx = prev.inputTokens + prev.cacheCreationTokens + prev.cacheReadTokens;
          const currCtx = msg.inputTokens + msg.cacheCreationTokens + msg.cacheReadTokens;
          const delta = currCtx - prevCtx;
          const sign = delta >= 0 ? '+' : '';
          const marginalCost = calculateCost(
            {
              inputTokens: Math.max(0, msg.inputTokens - prev.inputTokens),
              cacheCreationTokens: Math.max(0, msg.cacheCreationTokens - prev.cacheCreationTokens),
              cacheReadTokens: Math.max(0, msg.cacheReadTokens - prev.cacheReadTokens),
              outputTokens: msg.outputTokens,
            },
            this.#config.model,
            this.#config.cacheTtl ?? CacheTtl.FiveMinutes,
          );
          const costStr = `$${marginalCost.toFixed(4)}`;
          this.#toolAnnotation += `[\u2191 ${sign}${delta.toLocaleString()} tokens \u00b7 ${costStr}]\n`;
          this.#redrawTools();
        }
        this.#lastUsage = msg;
        this.#statusState.update(msg);
        break;
      }
      case 'done':
        this.#logger.info('done', { stopReason: msg.stopReason });
        if (msg.stopReason !== 'end_turn') {
          this.#conversation.appendStreaming(`\n\n[stop: ${msg.stopReason}]`);
        }
        break;
      case 'error':
        this.#conversation.appendStreaming(`\n\n[error: ${msg.message}]`);
        this.#logger.error('error', { message: msg.message });
        break;
      case 'turn_content':
        // Canonical per-turn content. Current rendering is driven by streaming
        // events; this payload is available for consumers that need it.
        break;
    }
  }

  /**
   * Open (or continue) the active tools block. The id-keyed map is the live set
   * for the current tools block, so it is reset only when a *fresh* tools block
   * opens — i.e. when the transition actually comes from a non-tools block.
   * Back-to-back tool turns (no text between) are a no-op transition, so their
   * tools accumulate in one block, each rendering its own phase.
   */
  #openToolsBlock(): void {
    const { from } = this.#conversation.transitionBlock('tools');
    if (from !== 'tools') {
      this.#toolObjects = new Map();
      this.#toolOrder = [];
      this.#toolAnnotation = '';
    }
  }

  #redrawTools(): void {
    const content = this.#toolOrder.map((id) => this.#toolObjects.get(id)?.render() ?? '').join('');
    this.#conversation.setActiveBlockContent(content + this.#toolAnnotation);
  }

  async #toolApprovalRequest(msg: SdkToolApprovalRequest, obj: ToolObject | null): Promise<void> {
    try {
      this.#logger.info('tool_approval_request', { name: msg.name, input: msg.input });
      const pendingTool: PendingTool = { requestId: msg.requestId, name: msg.name, input: msg.input };
      this.#tools.addTool(pendingTool);
      const perm = getPermission({ name: msg.name, input: msg.input }, this.#config.tools, this.#cwd);
      let approved: boolean;
      if (perm === PermissionAction.Approve) {
        this.#logger.info('Auto approving', { name: msg.name });
        approved = true;
      } else if (perm === PermissionAction.Deny) {
        this.#logger.info('Auto denying', { name: msg.name });
        approved = false;
      } else {
        this.#notifier.start(msg);
        approved = await this.#tools.requestApproval();
        this.#notifier.cancel();
      }
      this.#channel.send({ type: 'tool_approval_response', requestId: msg.requestId, approved });
      this.#tools.removeTool(msg.requestId);
      if (approved) {
        obj?.approve();
      } else {
        obj?.deny();
      }
      this.#redrawTools();
    } catch (err) {
      this.#logger.error('Error', err);
      this.#channel.send({ type: 'tool_approval_response', requestId: msg.requestId, approved: false });
      this.#tools.removeTool(msg.requestId);
      obj?.error();
      this.#redrawTools();
    }
  }
}
