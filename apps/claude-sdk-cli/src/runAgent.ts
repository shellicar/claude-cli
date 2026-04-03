import { IAnthropicAgent, AnthropicBeta, type SdkMessage } from '@shellicar/claude-sdk';
import { ConfirmEditFile } from '@shellicar/claude-sdk-tools/ConfirmEditFile';
import { EditFile } from '@shellicar/claude-sdk-tools/EditFile';
import { GrepFile } from '@shellicar/claude-sdk-tools/GrepFile';
import { ReadFile } from '@shellicar/claude-sdk-tools/ReadFile';
import { logger } from './logger';

export async function runAgent(agent: IAnthropicAgent, prompt: string): Promise<void> {
  const { port, done } = agent.runAgent({
    model: 'claude-sonnet-4-6',
    maxTokens: 8096,
    messages: [prompt],
    tools: [EditFile, ConfirmEditFile, ReadFile, GrepFile],
    requireToolApproval: true,
    betas: {
      [AnthropicBeta.ClaudeCodeAuth]: true,
      [AnthropicBeta.InterleavedThinking]: true,
      [AnthropicBeta.ContextManagement]: true,
      [AnthropicBeta.PromptCachingScope]: true,
      [AnthropicBeta.Effort]: true,
      [AnthropicBeta.AdvancedToolUse]: true,
      [AnthropicBeta.TokenEfficientTools]: true,
    },
  });

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
        logger.info('tool_approval_request', { name: msg.name, input: msg.input });
        port.postMessage({ type: 'tool_approval_response', requestId: msg.requestId, approved: true });
        break;
      case 'done':
        logger.info('done', { stopReason: msg.stopReason });
        break;
      case 'error':
        logger.error('error', { message: msg.message });
        break;
    }
  });

  await done;
}
