import { resolve, sep } from 'node:path';
import { AnthropicBeta, type AnyToolDefinition, type IAnthropicAgent, type SdkMessage, type SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import { ConfirmEditFile } from '@shellicar/claude-sdk-tools/ConfirmEditFile';
import { CreateFile } from '@shellicar/claude-sdk-tools/CreateFile';
import { DeleteDirectory } from '@shellicar/claude-sdk-tools/DeleteDirectory';
import { DeleteFile } from '@shellicar/claude-sdk-tools/DeleteFile';
import { EditFile } from '@shellicar/claude-sdk-tools/EditFile';
import { Find } from '@shellicar/claude-sdk-tools/Find';
import { Grep } from '@shellicar/claude-sdk-tools/Grep';
import { Head } from '@shellicar/claude-sdk-tools/Head';
import { createPipe } from '@shellicar/claude-sdk-tools/Pipe';
import { Range } from '@shellicar/claude-sdk-tools/Range';
import { ReadFile } from '@shellicar/claude-sdk-tools/ReadFile';
import { SearchFiles } from '@shellicar/claude-sdk-tools/SearchFiles';
import { Exec } from '@shellicar/claude-sdk-tools/Exec';
import { Tail } from '@shellicar/claude-sdk-tools/Tail';
import { logger } from './logger';
import type { ReadLine } from './ReadLine';

type PermissionLevel = 'approve' | 'ask' | 'deny';
type ZonePermissions = { read: PermissionLevel; write: PermissionLevel; delete: PermissionLevel };
type PermissionConfig = { default: ZonePermissions; outside: ZonePermissions };

const PERMISSION_RANK: Record<PermissionLevel, 0 | 1 | 2> = { approve: 0, ask: 1, deny: 2 };

const permissions: PermissionConfig = {
  default: { read: 'approve', write: 'approve', delete: 'ask' },
  outside: { read: 'approve', write: 'ask', delete: 'deny' },
};

function getPathFromInput(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName === 'EditFile' || toolName === 'ConfirmEditFile') {
    return typeof input.file === 'string' ? input.file : undefined;
  }
  return typeof input.path === 'string' ? input.path : undefined;
}

function isInsideCwd(filePath: string, cwd: string): boolean {
  const resolved = resolve(filePath);
  return resolved === cwd || resolved.startsWith(cwd + sep);
}

function getPermission(toolName: string, input: Record<string, unknown>, allTools: AnyToolDefinition[], cwd: string): 0 | 1 | 2 {
  if (toolName === 'Pipe') {
    const steps = input.steps as Array<{ tool: string; input: Record<string, unknown> }> | undefined;
    if (!Array.isArray(steps) || steps.length === 0) return PERMISSION_RANK['ask'];
    return Math.max(...steps.map((s) => getPermission(s.tool, s.input, allTools, cwd))) as 0 | 1 | 2;
  }

  const tool = allTools.find((t) => t.name === toolName);
  if (!tool) return PERMISSION_RANK['deny'];

  const operation = tool.operation ?? 'read';
  const filePath = getPathFromInput(toolName, input);
  const zone: keyof PermissionConfig = filePath != null && !isInsideCwd(filePath, cwd) ? 'outside' : 'default';

  return PERMISSION_RANK[permissions[zone][operation]];
}

export async function runAgent(agent: IAnthropicAgent, prompt: string, rl: ReadLine): Promise<void> {
  const pipeSource = [Find, ReadFile, Grep, Head, Tail, Range, SearchFiles];
  const writeTools = [EditFile, ConfirmEditFile, CreateFile, DeleteFile, DeleteDirectory, Exec];
  const pipe = createPipe(pipeSource) as AnyToolDefinition;
  const tools = [pipe, ...pipeSource, ...writeTools] satisfies AnyToolDefinition[];

  const cwd = process.cwd();

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
      const perm = getPermission(msg.name, msg.input, tools, cwd);
      if (perm === 0) {
        logger.info('Auto approving', { name: msg.name });
        port.postMessage({ type: 'tool_approval_response', requestId: msg.requestId, approved: true });
        return;
      }
      if (perm === 2) {
        logger.info('Auto denying', { name: msg.name });
        port.postMessage({ type: 'tool_approval_response', requestId: msg.requestId, approved: false });
        return;
      }
      const approve = await rl.prompt('Approve tool?', ['Y', 'N'] as const);
      port.postMessage({ type: 'tool_approval_response', requestId: msg.requestId, approved: approve === 'Y' });
    } catch (err) {
      logger.error('Error', err);
      port.postMessage({ type: 'tool_approval_response', requestId: msg.requestId, approved: false });
    }
  };

  port.on('message', (msg: SdkMessage) => {
    switch (msg.type) {
      case 'message_start':
        process.stdout.write('> ');
        break;
      case 'message_text':
        process.stdout.write(msg.text);
        break;
      case 'message_end':
        process.stdout.write('\n');
        break;
      case 'tool_approval_request':
        toolApprovalRequest(msg);
        break;
      case 'done':
        logger.info('done', { stopReason: msg.stopReason });
        break;
      case 'error':
        logger.error('error', { message: msg.message });
        break;
    }
  });

  rl.onCancel = () => port.postMessage({ type: 'cancel' });

  await done;

  rl.onCancel = undefined;
}
