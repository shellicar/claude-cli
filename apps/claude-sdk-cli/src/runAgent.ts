import { relative } from 'node:path';
import { AnthropicBeta, type AnyToolDefinition, type IAnthropicAgent, type SdkMessage, type SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import { ConfirmEditFile } from '@shellicar/claude-sdk-tools/ConfirmEditFile';
import { CreateFile } from '@shellicar/claude-sdk-tools/CreateFile';
import { DeleteDirectory } from '@shellicar/claude-sdk-tools/DeleteDirectory';
import { DeleteFile } from '@shellicar/claude-sdk-tools/DeleteFile';
import { EditFile } from '@shellicar/claude-sdk-tools/EditFile';
import { Exec } from '@shellicar/claude-sdk-tools/Exec';
import { Find } from '@shellicar/claude-sdk-tools/Find';
import { Grep } from '@shellicar/claude-sdk-tools/Grep';
import { Head } from '@shellicar/claude-sdk-tools/Head';
import { createPipe } from '@shellicar/claude-sdk-tools/Pipe';
import { Range } from '@shellicar/claude-sdk-tools/Range';
import { ReadFile } from '@shellicar/claude-sdk-tools/ReadFile';
import { SearchFiles } from '@shellicar/claude-sdk-tools/SearchFiles';
import { Tail } from '@shellicar/claude-sdk-tools/Tail';
import type { AppLayout, PendingTool } from './AppLayout.js';
import { logger } from './logger.js';
import { PermissionAction, getPermission } from './permissions.js';

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

function formatToolSummary(name: string, input: Record<string, unknown>, cwd: string): string {
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

export async function runAgent(agent: IAnthropicAgent, prompt: string, layout: AppLayout): Promise<void> {
  const pipeSource = [Find, ReadFile, Grep, Head, Tail, Range, SearchFiles];
  const writeTools = [EditFile, ConfirmEditFile, CreateFile, DeleteFile, DeleteDirectory, Exec];
  const pipe = createPipe(pipeSource);
  const tools: AnyToolDefinition[] = [pipe, ...pipeSource, ...writeTools];

  const cwd = process.cwd();

  layout.startStreaming(prompt);

  const { port, done } = agent.runAgent({
    model: 'claude-sonnet-4-6',
    maxTokens: 8096,
    messages: [prompt],
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
        layout.appendStreaming(`${formatToolSummary(msg.name, msg.input, cwd)}\n`);
        toolApprovalRequest(msg);
        break;
      case 'message_compaction':
        layout.transitionBlock('compaction');
        layout.appendStreaming(msg.summary);
        break;
      case 'done':
        logger.info('done', { stopReason: msg.stopReason });
        if (msg.stopReason !== 'end_turn') {
          layout.appendStreaming(`\n\n[stop: ${msg.stopReason}]`);
        }
        break;
      case 'error':
        layout.transitionBlock('response');
        layout.appendStreaming(`\n[Error: ${msg.message}]`);
        logger.error('error', { message: msg.message });
        break;
    }
  });

  layout.setCancelFn(() => port.postMessage({ type: 'cancel' }));

  await done;

  layout.setCancelFn(null);
  layout.completeStreaming();
}
