import { AnthropicBeta, createAnthropicAgent, type SdkMessage } from '@shellicar/claude-sdk';
import { logger } from './logger';
import { editConfirmTool } from './tools/edit/editConfirmTool';
import { editTool } from './tools/edit/editTool';

const main = async () => {
  const agent = createAnthropicAgent({
    apiKey: process.env.CLAUDE_CODE_API_KEY ?? 'no-key',
    logger,
  });

  const { port, done } = agent.runAgent({
    model: 'claude-sonnet-4-6',
    maxTokens: 8096,
    messages: ['Please add a comment "// hello world" on line 1344 of the file /Users/stephen/repos/@shellicar/claude-cli/node_modules/.pnpm/@anthropic-ai+sdk@0.80.0_zod@4.3.6/node_modules/@anthropic-ai/sdk/src/resources/messages/messages.ts'],
    tools: [editTool, editConfirmTool],
    requireToolApproval: true,
    betas: {
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
};
main();
