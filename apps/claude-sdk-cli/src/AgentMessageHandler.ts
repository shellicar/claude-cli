import { relative } from 'node:path';
import type { MessagePort } from 'node:worker_threads';
import { calculateCost, type DurableConfig, type SdkMessage, type SdkMessageUsage, type SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import type { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import type { AppLayout, PendingTool } from './AppLayout.js';
import type { logger } from './logger.js';
import { getPermission, PermissionAction } from './permissions.js';

// ---- helpers (moved from runAgent.ts) ------------------------------------

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
  port: MessagePort;
  cwd: string;
  store: RefStore;
}

// ---- class ---------------------------------------------------------------

/**
 * Handles all SdkMessage cases: routes each message to the appropriate
 * layout call or state mutation.
 *
 * Stateless cases (query_summary, message_thinking, etc.) just delegate to
 * layout. Stateful cases maintain usageBeforeTools / lastUsage to produce
 * the per-tool-batch token-delta annotation on the sealed tools block.
 */
export class AgentMessageHandler {
  #layout: AppLayout;
  #logger: typeof logger;
  #config: DurableConfig;
  #port: MessagePort;
  #cwd: string;
  #store: RefStore;
  #lastUsage: SdkMessageUsage | null = null;
  #usageBeforeTools: SdkMessageUsage | null = null;

  public constructor(layout: AppLayout, log: typeof logger, opts: AgentMessageHandlerOptions) {
    this.#layout = layout;
    this.#logger = log;
    this.#config = opts.config;
    this.#port = opts.port;
    this.#cwd = opts.cwd;
    this.#store = opts.store;
  }

  public handle(msg: SdkMessage): void {
    switch (msg.type) {
      case 'query_summary': {
        const parts = [`${msg.systemPrompts} system`, `${msg.userMessages} user`, `${msg.assistantMessages} assistant`, ...(msg.thinkingBlocks > 0 ? [`${msg.thinkingBlocks} thinking`] : [])];
        this.#layout.transitionBlock('meta');
        const deltaLine = msg.systemReminder ? `\n${msg.systemReminder}` : '';
        this.#layout.appendStreaming(`\uD83E\uDD16 ${this.#config.model}\n${parts.join(' \u00b7 ')}${deltaLine}`);
        break;
      }
      case 'message_thinking':
        this.#layout.transitionBlock('thinking');
        this.#layout.appendStreaming(msg.text);
        break;
      case 'message_text':
        this.#layout.transitionBlock('response');
        this.#layout.appendStreaming(msg.text);
        break;
      case 'message_compaction_start':
        this.#layout.transitionBlock('compaction');
        break;
      case 'message_compaction': {
        this.#layout.transitionBlock('compaction');
        this.#layout.appendStreaming(msg.summary);
        if (this.#lastUsage) {
          const used = this.#lastUsage.inputTokens + this.#lastUsage.cacheCreationTokens + this.#lastUsage.cacheReadTokens;
          const pct = ((used / this.#lastUsage.contextWindow) * 100).toFixed(1);
          const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
          this.#layout.appendStreaming(`\n\n[compacted at ${fmt(used)} / ${fmt(this.#lastUsage.contextWindow)} (${pct}%)]`);
        }
        break;
      }
      case 'tool_approval_request':
        this.#layout.transitionBlock('tools');
        if (!this.#usageBeforeTools) {
          this.#usageBeforeTools = this.#lastUsage;
        }
        void this.#toolApprovalRequest(msg);
        break;
      case 'tool_error':
        this.#layout.transitionBlock('tools');
        this.#layout.appendStreaming(`${msg.name} error\n\`\`\`json\n${JSON.stringify(msg.input, null, 2)}\n\`\`\`\n\n${msg.error}\n`);
        break;
      case 'message_usage': {
        this.#logger.debug('message_usage', { hasUsageBeforeTools: this.#usageBeforeTools !== null });
        if (this.#usageBeforeTools !== null) {
          const prev = this.#usageBeforeTools;
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
            this.#config.cacheTtl,
          );
          const costStr = `$${marginalCost.toFixed(4)}`;
          this.#logger.debug('tool_batch_tokens', { prevCtx, currCtx, delta, marginalCost });
          this.#layout.appendToLastSealed('tools', `[\u2191 ${sign}${delta.toLocaleString()} tokens \u00b7 ${costStr}]\n`);
          this.#usageBeforeTools = null;
        }
        this.#lastUsage = msg;
        this.#layout.updateUsage(msg);
        break;
      }
      case 'done':
        this.#logger.info('done', { stopReason: msg.stopReason });
        if (msg.stopReason !== 'end_turn') {
          this.#layout.appendStreaming(`\n\n[stop: ${msg.stopReason}]`);
        }
        break;
      case 'error':
        this.#layout.transitionBlock('response');
        this.#layout.appendStreaming(`\n\n[error: ${msg.message}]`);
        this.#logger.error('error', { message: msg.message });
        break;
    }
  }

  async #toolApprovalRequest(msg: SdkToolApprovalRequest): Promise<void> {
    try {
      this.#logger.info('tool_approval_request', { name: msg.name, input: msg.input });
      const pendingTool: PendingTool = { requestId: msg.requestId, name: msg.name, input: msg.input };
      this.#layout.addPendingTool(pendingTool);
      const perm = getPermission({ name: msg.name, input: msg.input }, this.#config.tools, this.#cwd);
      let approved: boolean;
      if (perm === PermissionAction.Approve) {
        this.#logger.info('Auto approving', { name: msg.name });
        approved = true;
      } else if (perm === PermissionAction.Deny) {
        this.#logger.info('Auto denying', { name: msg.name });
        approved = false;
      } else {
        approved = await this.#layout.requestApproval();
      }
      this.#port.postMessage({ type: 'tool_approval_response', requestId: msg.requestId, approved });
      this.#layout.removePendingTool(msg.requestId);
      const summary = formatToolSummary(msg.name, msg.input, this.#cwd, this.#store);
      this.#layout.appendStreaming(`${summary} ${approved ? '✅' : '❌'}\n`);
    } catch (err) {
      this.#logger.error('Error', err);
      this.#port.postMessage({ type: 'tool_approval_response', requestId: msg.requestId, approved: false });
      this.#layout.removePendingTool(msg.requestId);
      const catchSummary = formatToolSummary(msg.name, msg.input, this.#cwd, this.#store);
      this.#layout.appendStreaming(`${catchSummary} 💥\n`);
    }
  }
}
