import { AnthropicBeta, type AnyToolDefinition, CacheTtl, type IAnthropicAgent, type SdkMessage } from '@shellicar/claude-sdk';
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
import { AgentMessageHandler } from './AgentMessageHandler.js';
import type { AppLayout } from './AppLayout.js';
import { writeAuditEvent } from './AuditWriter.js';
import { logger } from './logger.js';
import { systemPrompts } from './systemPrompts.js';

export async function runAgent(agent: IAnthropicAgent, prompt: string, layout: AppLayout, store: RefStore, model: string, gitDelta?: string, cachedReminders?: string[]): Promise<void> {
  const pipeSource = [Find, ReadFile, Grep, Head, Tail, Range, SearchFiles];
  const { tool: Ref, transformToolResult: refTransform } = createRef(store, 20_000);
  const otherTools = [PreviewEdit, EditFile, CreateFile, DeleteFile, DeleteDirectory, Exec, Ref];
  const pipe = createPipe(pipeSource);
  const tools: AnyToolDefinition[] = [pipe, ...pipeSource, ...otherTools];

  const cwd = process.cwd();
  const cacheTtl = CacheTtl.OneHour;

  const transformToolResult = (toolName: string, output: unknown): unknown => {
    const result = refTransform(toolName, output);
    if (toolName !== 'Ref') {
      const bytes = (typeof result === 'string' ? result : JSON.stringify(result)).length;
      logger.debug('tool_result_size', { name: toolName, bytes });
    }
    return result;
  };

  layout.setModel(model);
  layout.startStreaming(prompt);

  const { port, done } = agent.runAgent({
    model,
    maxTokens: 32000,
    messages: [prompt],
    systemPrompts,
    systemReminder: gitDelta,
    cachedReminders,
    cacheTtl,
    transformToolResult,
    pauseAfterCompact: true,
    compactInputTokens: 160_000,
    tools,
    requireToolApproval: true,
    thinking: true,
    betas: {
      [AnthropicBeta.Compact]: true,
      [AnthropicBeta.ClaudeCodeAuth]: true,
      // [AnthropicBeta.InterleavedThinking]: true,
      [AnthropicBeta.ContextManagement]: false,
      [AnthropicBeta.PromptCachingScope]: false,
      // [AnthropicBeta.Effort]: true,
      [AnthropicBeta.AdvancedToolUse]: true,
      // [AnthropicBeta.TokenEfficientTools]: true,
    },
  });

  const respond = (requestId: string, approved: boolean) => {
    port.postMessage({ type: 'tool_approval_response', requestId, approved });
  };

  const handler = new AgentMessageHandler(layout, logger, { model, cacheTtl, cwd, store, tools, respond });

  port.on('message', (msg: SdkMessage) => handler.handle(msg));

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
