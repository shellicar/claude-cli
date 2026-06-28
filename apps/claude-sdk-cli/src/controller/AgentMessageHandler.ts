import { relative } from 'node:path';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { CacheTtl, calculateCost, type DurableConfig, IDurableConfigProvider, type SdkMessage, type SdkMessageUsage, type SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import type { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { dependsOn } from '@shellicar/core-di-lite';
import { ApprovalNotifier } from '../model/ApprovalNotifier.js';
import { ConversationState } from '../model/ConversationState.js';
import { StatusState } from '../model/StatusState.js';
import { type PendingTool, ToolApprovalState } from '../model/ToolApprovalState.js';
import { ToolObject } from '../model/ToolObject.js';
import { buildPermissionMatrix, getPermission, PermissionAction, type PermissionConfig } from '../permissions.js';
import { AppToolsService } from '../setup/AppToolsService.js';
import { ConsumerChannel } from '../setup/ConsumerChannel.js';

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

// ---- class ---------------------------------------------------------------

/**
 * Block type mapping from raw Anthropic API content block types to the visual
 * block types used by ConversationState. Returns null for types that have no
 * visual representation (server tool results, unknown types).
 */
// Maps API content block types to visual block types for non-tool blocks.
// tool_use and server_tool_use are handled by tool_batch_start/end, not block_enter/exit.
function toVisualBlockType(apiType: string): 'thinking' | 'response' | 'compaction' | null {
  switch (apiType) {
    case 'text':
      return 'response';
    case 'thinking':
      return 'thinking';
    case 'compaction':
      return 'compaction';
    default:
      return null;
  }
}

/**
 * Handles all SdkMessage cases: routes each message to the appropriate
 * state mutation or channel send.
 *
 * Block lifecycle is driven by explicit block_enter / block_exit events from
 * the SDK (mapped from the API's content_block_start / content_block_stop).
 * Delta events (message_text, message_thinking, etc.) append to the already-
 * open block without opening one themselves. The tools visual block spans the
 * full tool-use phase of a turn and is sealed by message_usage.
 */
export class AgentMessageHandler {
  @dependsOn(ILogger) private readonly logger!: ILogger;
  @dependsOn(IDurableConfigProvider) private readonly durableProvider!: IDurableConfigProvider;
  @dependsOn(ConsumerChannel) private readonly channel!: ConsumerChannel;
  @dependsOn(AppToolsService) private readonly appTools!: AppToolsService;
  @dependsOn(StatusState) private readonly statusState!: StatusState;
  @dependsOn(ApprovalNotifier) private readonly notifier!: ApprovalNotifier;
  @dependsOn(ConversationState) private readonly conversation!: ConversationState;
  @dependsOn(ToolApprovalState) private readonly tools!: ToolApprovalState;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  #lastUsage: SdkMessageUsage | null = null;
  #toolObjects = new Map<string, ToolObject>();
  #toolOrder: string[] = [];
  #toolAnnotation = '';

  // Live view of the per-turn-mutated durable config (held by reference).
  get #config(): DurableConfig {
    return this.durableProvider.config;
  }

  // Cheap derivation, cannot fail.
  get #cwd(): string {
    return this.fs.cwd();
  }

  get #store(): RefStore {
    return this.appTools.store;
  }

  #getMatrix(): PermissionConfig {
    return buildPermissionMatrix(this.configLoader.config.permissions);
  }

  public handle(msg: SdkMessage): void {
    switch (msg.type) {
      case 'query_summary': {
        const parts = [`${msg.systemPrompts} system`, `${msg.userMessages} user`, `${msg.assistantMessages} assistant`, ...(msg.thinkingBlocks > 0 ? [`${msg.thinkingBlocks} thinking`] : [])];
        this.conversation.transitionBlock('meta');
        const deltaLine = msg.systemReminder ? `\n${msg.systemReminder}` : '';
        this.conversation.appendStreaming(`\uD83E\uDD16 ${this.#config.model}\n${parts.join(' \u00b7 ')}${deltaLine}`);
        break;
      }
      case 'tool_batch_start':
        // The SDK guarantees this fires once per message, before the first tool_use block.
        // Open the visual tools block and reset all per-batch state.
        this.conversation.transitionBlock('tools');
        this.#toolObjects = new Map();
        this.#toolOrder = [];
        this.#toolAnnotation = '';
        break;
      case 'tool_batch_end':
        // stop_reason === 'tool_use' has fired. The tools block stays open through
        // the approval and execution phase; message_usage seals it.
        break;
      case 'block_enter': {
        // tool_use/server_tool_use lifecycle is managed by tool_batch_start/end.
        const visual = toVisualBlockType(msg.blockType);
        if (visual !== null) {
          this.conversation.transitionBlock(visual);
        }
        break;
      }
      case 'block_exit': {
        const visual = toVisualBlockType(msg.blockType);
        if (visual !== null) {
          this.conversation.completeActive();
        }
        break;
      }
      case 'message_thinking':
        this.conversation.appendStreaming(msg.text);
        break;
      case 'message_text':
        this.conversation.appendStreaming(msg.text);
        break;
      case 'message_compaction': {
        this.conversation.appendStreaming(msg.summary);
        if (this.#lastUsage) {
          const used = this.#lastUsage.inputTokens + this.#lastUsage.cacheCreationTokens + this.#lastUsage.cacheReadTokens;
          const pct = ((used / this.#lastUsage.contextWindow) * 100).toFixed(1);
          const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
          this.conversation.appendStreaming(`\n\n[compacted at ${fmt(used)} / ${fmt(this.#lastUsage.contextWindow)} (${pct}%)]`);
        }
        break;
      }
      case 'server_tool_use': {
        this.logger.debug('server_tool_use', { id: msg.id, name: msg.name });
        const obj = this.#toolObjects.get(msg.id);
        if (obj) {
          obj.resolve(formatToolSummary(msg.name, msg.input, this.#cwd, this.#store));
          obj.setInput(msg.input);
          // emit drives #redrawTools
        }
        break;
      }
      case 'server_tool_result':
        this.#toolObjects.get(msg.id)?.complete();
        this.#toolObjects.get(msg.id)?.setOutput(typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result));
        // emit drives #redrawTools
        break;
      case 'tool_result':
        this.#toolObjects.get(msg.id)?.setOutput(msg.content);
        // emit drives #redrawTools
        break;
      case 'tool_use_start': {
        // block_enter('tool_use') already opened the visual tools block.
        const clientObj = new ToolObject(msg.id, 'client', msg.name);
        clientObj.on('change', () => this.#redrawTools());
        this.#toolObjects.set(msg.id, clientObj);
        this.#toolOrder.push(msg.id);
        this.#redrawTools(); // show initial streaming state before first delta
        break;
      }
      case 'server_tool_use_start': {
        // block_enter('server_tool_use') already opened the visual tools block.
        this.logger.info('server_tool_use_start', { id: msg.id, name: msg.name });
        const serverObj = new ToolObject(msg.id, 'server', msg.name);
        serverObj.on('change', () => this.#redrawTools());
        this.#toolObjects.set(msg.id, serverObj);
        this.#toolOrder.push(msg.id);
        this.#redrawTools(); // show initial streaming state
        break;
      }
      case 'tool_use_input_delta':
        this.#toolObjects.get(msg.id)?.appendInput(msg.partialJson);
        // emit drives #redrawTools
        break;
      case 'tool_use_input_stop': {
        // The input block is complete and the SDK has parsed it. Flip the tool from the
        // raw streamed JSON to its resolved view now.
        const obj = this.#toolObjects.get(msg.id);
        if (obj) {
          obj.resolve(formatToolSummary(obj.name, msg.input, this.#cwd, this.#store));
          obj.setInput(msg.input);
          // emit drives #redrawTools
        }
        break;
      }
      case 'tool_approval_request': {
        // No block transition needed — tools block already exists (active or sealed).
        // ToolObject.resolve() emits change which drives #redrawTools via setLastContent.
        const approvalObj = this.#toolObjects.get(msg.requestId) ?? null;
        if (approvalObj) {
          approvalObj.resolve(formatToolSummary(msg.name, msg.input, this.#cwd, this.#store));
          // emit drives #redrawTools
        }
        void this.#toolApprovalRequest(msg, approvalObj);
        break;
      }
      case 'tool_error':
        // Error during tool dispatch — no active block at this point, appendStreaming
        // opens a notice block so the error lands visibly without a new tools block.
        this.conversation.appendStreaming(`${msg.name} error\n\`\`\`json\n${JSON.stringify(msg.input, null, 2)}\n\`\`\`\n\n${msg.error}\n`);
        break;
      case 'message_usage': {
        // Per-turn token-delta annotation, appended while a tools block is active.
        // Guarded on the active block type (not the persisted map) so a pure-text
        // turn after a tools turn does not pick up a spurious annotation.
        const prev = this.#lastUsage;
        if (this.conversation.activeBlock?.type === 'tools' && prev !== null) {
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
        this.conversation.completeActive();
        this.#lastUsage = msg;
        this.statusState.update(msg);
        break;
      }
      case 'done':
        this.logger.info('done', { stopReason: msg.stopReason });
        if (msg.stopReason !== 'end_turn') {
          this.conversation.appendStreaming(`\n\n[stop: ${msg.stopReason}]`);
        }
        break;
      case 'error':
        this.conversation.appendStreaming(`\n\n[error: ${msg.message}]`);
        this.logger.error('error', { message: msg.message });
        break;
      case 'turn_content':
        // Canonical per-turn content. Current rendering is driven by streaming
        // events; this payload is available for consumers that need it.
        break;
    }
  }

  #redrawTools(): void {
    const content = this.#toolOrder.map((id) => this.#toolObjects.get(id)?.render() ?? '').join('');
    const entries = this.#toolOrder.flatMap((id) => {
      const obj = this.#toolObjects.get(id);
      return obj ? [obj.toEntry()] : [];
    });
    this.conversation.setLastTools(content + this.#toolAnnotation, entries);
  }

  async #toolApprovalRequest(msg: SdkToolApprovalRequest, obj: ToolObject | null): Promise<void> {
    try {
      this.logger.info('tool_approval_request', { name: msg.name, input: msg.input });
      const pendingTool: PendingTool = { requestId: msg.requestId, name: msg.name, input: msg.input };
      this.tools.addTool(pendingTool);
      const perm = getPermission({ name: msg.name, input: msg.input }, this.#config.tools, this.#cwd, this.#getMatrix(), this.fs);
      let approved: boolean;
      if (perm === PermissionAction.Approve) {
        this.logger.info('Auto approving', { name: msg.name });
        approved = true;
      } else if (perm === PermissionAction.Deny) {
        this.logger.info('Auto denying', { name: msg.name });
        approved = false;
      } else {
        this.notifier.start(msg);
        approved = await this.tools.requestApproval();
        this.notifier.cancel();
      }
      this.channel.send({ type: 'tool_approval_response', requestId: msg.requestId, approved });
      this.tools.removeTool(msg.requestId);
      if (approved) {
        obj?.approve();
      } else {
        obj?.deny();
      }
      // emit drives #redrawTools
    } catch (err) {
      this.logger.error('Error', err);
      this.channel.send({ type: 'tool_approval_response', requestId: msg.requestId, approved: false });
      this.tools.removeTool(msg.requestId);
      obj?.error();
      // emit drives #redrawTools
    }
  }
}
