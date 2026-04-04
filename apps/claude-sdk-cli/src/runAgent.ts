import { IAnthropicAgent, AnthropicBeta, type SdkMessage } from '@shellicar/claude-sdk';
import { ConfirmEditFile } from '@shellicar/claude-sdk-tools/ConfirmEditFile';
import { EditFile } from '@shellicar/claude-sdk-tools/EditFile';
import { DeleteFile } from '@shellicar/claude-sdk-tools/DeleteFile';
import { CreateFile } from '@shellicar/claude-sdk-tools/CreateFile';
import { DeleteDirectory } from '@shellicar/claude-sdk-tools/DeleteDirectory';
import { Find } from '@shellicar/claude-sdk-tools/Find';
import { Grep } from '@shellicar/claude-sdk-tools/Grep';
import { Head } from '@shellicar/claude-sdk-tools/Head';
import { Range } from '@shellicar/claude-sdk-tools/Range';
import { ReadFile } from '@shellicar/claude-sdk-tools/ReadFile';
import { Tail } from '@shellicar/claude-sdk-tools/Tail';
import { SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import { logger } from './logger';
import { ReadLine } from './ReadLine';

export async function runAgent(agent: IAnthropicAgent, prompt: string, rl: ReadLine): Promise<void> {
  const { port, done } = agent.runAgent({
    model: 'claude-sonnet-4-6',
    maxTokens: 8096,
    messages: [prompt],
    tools: [EditFile, ConfirmEditFile, ReadFile, CreateFile, DeleteFile, DeleteDirectory, Find, Grep, Head, Range, Tail],
    requireToolApproval: true,
    betas: {
      [AnthropicBeta.Compact]: true,
      [AnthropicBeta.ClaudeCodeAuth]: true,
      [AnthropicBeta.InterleavedThinking]: true,
      [AnthropicBeta.ContextManagement]: true,
      [AnthropicBeta.PromptCachingScope]: true,
      [AnthropicBeta.Effort]: true,
      [AnthropicBeta.AdvancedToolUse]: true,
      [AnthropicBeta.TokenEfficientTools]: true,
    },
  });

  const toolApprovalRequest = async (msg: SdkToolApprovalRequest) => {
    try {
      logger.info('tool_approval_request', { name: msg.name, input: msg.input });
      const approve = await rl.prompt('Approve tool?', ['Y', 'N'] as const);
      const approved = approve === 'Y';
      port.postMessage({ type: 'tool_approval_response', requestId: msg.requestId, approved });
    }
    catch (err) {
      logger.error(err);
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

  await done;
}
