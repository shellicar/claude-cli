import { relative } from 'node:path';
import { AnthropicBeta, type AnyToolDefinition, type IAnthropicAgent, type SdkMessage, type SdkMessageUsage, type SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import { CreateFile } from '@shellicar/claude-sdk-tools/CreateFile';
import { DeleteDirectory } from '@shellicar/claude-sdk-tools/DeleteDirectory';
import { DeleteFile } from '@shellicar/claude-sdk-tools/DeleteFile';
import { EditFile } from '@shellicar/claude-sdk-tools/EditFile';
import { Exec } from '@shellicar/claude-sdk-tools/Exec';
import { Find } from '@shellicar/claude-sdk-tools/Find';
import { Grep } from '@shellicar/claude-sdk-tools/Grep';
import { Head } from '@shellicar/claude-sdk-tools/Head';
import { createPipe } from '@shellicar/claude-sdk-tools/Pipe';
import { PreviewEdit } from '@shellicar/claude-sdk-tools/PreviewEdit';
import { Range } from '@shellicar/claude-sdk-tools/Range';
import { ReadFile } from '@shellicar/claude-sdk-tools/ReadFile';
import { createRef } from '@shellicar/claude-sdk-tools/Ref';
import type { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { SearchFiles } from '@shellicar/claude-sdk-tools/SearchFiles';
import { Tail } from '@shellicar/claude-sdk-tools/Tail';
import type { AppLayout, PendingTool } from './AppLayout.js';
import { logger } from './logger.js';
import { getPermission, PermissionAction } from './permissions.js';

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
    return `Ref(${id.slice(0, 8)}…)`;
  }
  const sizeStr = fmtBytes(content.length);
  // start and limit always have defaults now (0 and 1000) so always show the range
  const start = typeof input.start === 'number' ? input.start : 0;
  const limit = typeof input.limit === 'number' ? input.limit : 1000;
  const end = Math.min(start + limit, content.length);
  return `Ref ← ${hint} [${start}–${end} / ${sizeStr}]`;
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

export async function runAgent(agent: IAnthropicAgent, prompt: string, layout: AppLayout, store: RefStore): Promise<void> {
  const pipeSource = [Find, ReadFile, Grep, Head, Tail, Range, SearchFiles];
  const { tool: Ref, transformToolResult: refTransform } = createRef(store, 2_000);
  const otherTools = [PreviewEdit, EditFile, CreateFile, DeleteFile, DeleteDirectory, Exec, Ref];
  const pipe = createPipe(pipeSource);
  const tools: AnyToolDefinition[] = [pipe, ...pipeSource, ...otherTools];

  const cwd = process.cwd();
  let lastUsage: SdkMessageUsage | null = null;
  /** Non-null while a tool batch is in-flight (set on first tool_approval_request, cleared on message_usage). */
  let usageBeforeTools: SdkMessageUsage | null = null;
  /** Result sizes accumulated per tool during the current batch (chars of JSON-serialised output). */
  const toolSizes: Array<{ name: string; bytes: number }> = [];

  /** Wraps the ref-transform to also record how many bytes each tool result consumed. */
  const transformToolResult = (toolName: string, output: unknown): unknown => {
    const result = refTransform(toolName, output);
    if (toolName !== 'Ref') {
      // Measure the serialised size — this is what actually enters the context window.
      const bytes = (typeof result === 'string' ? result : JSON.stringify(result)).length;
      toolSizes.push({ name: toolName, bytes });
      logger.debug('tool_result_size', { name: toolName, bytes });
    }
    return result;
  };

  layout.startStreaming(prompt);

  const { port, done } = agent.runAgent({
    model: 'claude-sonnet-4-6',
    maxTokens: 32768,
    messages: [prompt],
    transformToolResult,
    tools,
    requireToolApproval: true,
    betas: {
      [AnthropicBeta.Compact]: true,
      [AnthropicBeta.ClaudeCodeAuth]: true,
      [AnthropicBeta.InterleavedThinking]: true,
      [AnthropicBeta.ContextManagement]: false,
      [AnthropicBeta.PromptCachingScope]: true,
      [AnthropicBeta.Effort]: true,
      [AnthropicBeta.AdvancedToolUse]: true,
      [AnthropicBeta.TokenEfficientTools]: true,
    },
  });

  const toolApprovalRequest = async (msg: SdkToolApprovalRequest) => {
    try {
      logger.info('tool_approval_request', { name: msg.name, input: msg.input });

      const pendingTool: PendingTool = { requestId: msg.requestId, name: msg.name, input: msg.input };
      layout.addPendingTool(pendingTool);

      const perm = getPermission({ name: msg.name, input: msg.input }, tools, cwd);
      let approved: boolean;
      if (perm === PermissionAction.Approve) {
        logger.info('Auto approving', { name: msg.name });
        approved = true;
      } else if (perm === PermissionAction.Deny) {
        logger.info('Auto denying', { name: msg.name });
        approved = false;
      } else {
        approved = await layout.requestApproval();
      }

      port.postMessage({ type: 'tool_approval_response', requestId: msg.requestId, approved });
      layout.removePendingTool(msg.requestId);
    } catch (err) {
      logger.error('Error', err);
      port.postMessage({ type: 'tool_approval_response', requestId: msg.requestId, approved: false });
      layout.removePendingTool(msg.requestId);
    }
  };

  port.on('message', (msg: SdkMessage) => {
    switch (msg.type) {
      case 'message_thinking':
        layout.transitionBlock('thinking');
        layout.appendStreaming(msg.text);
        break;
      case 'message_text':
        layout.transitionBlock('response');
        layout.appendStreaming(msg.text);
        break;
      case 'tool_approval_request':
        layout.transitionBlock('tools');
        layout.appendStreaming(`${formatToolSummary(msg.name, msg.input, cwd, store)}\n`);
        // Snapshot usage at the start of the first tool in this batch so we can
        // compute the per-batch turn cost when the next message_usage arrives.
        if (!usageBeforeTools) {
          usageBeforeTools = lastUsage;
        }
        toolApprovalRequest(msg);
        break;
      case 'tool_error':
        layout.transitionBlock('tools');
        layout.appendStreaming(`${msg.name} error\n\`\`\`json\n${JSON.stringify(msg.input, null, 2)}\n\`\`\`\n\n${msg.error}\n`);
        break;
      case 'message_compaction_start':
        layout.transitionBlock('compaction');
        break;
      case 'message_compaction':
        layout.transitionBlock('compaction');
        layout.appendStreaming(msg.summary);
        if (lastUsage) {
          const used = lastUsage.inputTokens + lastUsage.cacheCreationTokens + lastUsage.cacheReadTokens;
          const pct = ((used / lastUsage.contextWindow) * 100).toFixed(1);
          const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
          layout.appendStreaming(`\n\n[compacted at ${fmt(used)} / ${fmt(lastUsage.contextWindow)} (${pct}%)]`);
        }
        break;
      case 'message_usage': {
        // If there was a tool batch before this turn, annotate the (now-sealed) tools block
        // with the result sizes returned to the model.
        // Note: we intentionally omit per-turn cost here — each API call bills for the full
        // context window re-read, so showing it next to "Exec: 559b" would be misleading.
        // The running total is visible in the status bar.
        if (usageBeforeTools !== null && toolSizes.length > 0) {
          const sizeParts = toolSizes.map((t) => `${t.name}: ${fmtBytes(t.bytes)}`).join(' \u00b7 ');
          layout.appendToLastSealed('tools', `[\u2191 ${sizeParts}]\n`);
          toolSizes.length = 0;
          usageBeforeTools = null;
        }
        lastUsage = msg;
        layout.updateUsage(msg);
        break;
      }
      case 'done':
        logger.info('done', { stopReason: msg.stopReason });
        if (msg.stopReason !== 'end_turn') {
          layout.appendStreaming(`\n\n[stop: ${msg.stopReason}]`);
        }
        break;
      case 'error':
        layout.transitionBlock('response');
        layout.appendStreaming(`\n\n[error: ${msg.message}]`);
        logger.error('error', { message: msg.message });
        break;
    }
  });

  layout.setCancelFn(() => port.postMessage({ type: 'cancel' }));

  try {
    await done;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    layout.transitionBlock('response');
    layout.appendStreaming(`\n\n[error: ${message}]`);
    logger.error('runAgent error', { message });
  } finally {
    layout.setCancelFn(null);
    layout.completeStreaming();
  }
}
